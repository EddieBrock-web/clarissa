/**
 * Apple On-Device AI LLM Provider
 *
 * Local provider using Apple's on-device foundation models via the
 * @meridius-labs/apple-on-device-ai library.
 * Requires macOS 26+ with Apple Silicon and Apple Intelligence enabled.
 */

import type { Message, ToolDefinition } from "../types.ts";
import type {
  LLMProvider,
  ProviderInfo,
  ProviderStatus,
  ChatOptions,
  ChatResponse,
} from "./types.ts";
import { usageTracker } from "../usage.ts";
import { parseModelOutput, StreamingOutputParser } from "./lmstudio.ts";

// Apple AI SDK types (dynamically imported)
type AppleAISDK = {
  chat: (options: AppleAIChatOptions) => Promise<AppleAIChatResponse> | AsyncIterable<string>;
  appleAISDK: {
    checkAvailability: () => Promise<boolean>;
    getSupportedLanguages: () => Promise<string[]>;
  };
};

type AppleAIChatOptions = {
  messages: string | Array<{ role: string; content: string }>;
  schema?: unknown;
  tools?: Array<{
    name: string;
    description: string;
    jsonSchema: unknown;
    handler?: (args: unknown) => Promise<unknown>;
  }>;
  stream?: boolean;
  temperature?: number;
  maxTokens?: number;
};

type AppleAIChatResponse = {
  text: string;
  object?: unknown;
  toolCalls?: Array<{
    id?: string;
    function: { name: string; arguments: string };
  }>;
};

export class AppleAIProvider implements LLMProvider {
  private sdk: AppleAISDK | null = null;

  readonly info: ProviderInfo = {
    id: "apple-ai",
    name: "Apple Intelligence",
    description: "On-device LLM inference using Apple Foundation Models (macOS 26+)",
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      embeddings: false,
      local: true,
      maxTools: 10, // Apple AI struggles with more than ~10 tools
    },
    // Apple AI has a single on-device model, not selectable
    availableModels: undefined,
  };

  async checkAvailability(): Promise<ProviderStatus> {
    try {
      // Check if we're on macOS
      if (process.platform !== "darwin") {
        return { available: false, reason: "Apple Intelligence is only available on macOS" };
      }

      // Check if SDK can be loaded
      const sdk = await this.loadSDK();
      if (!sdk) {
        return {
          available: false,
          reason: "Apple AI SDK not installed. Run: bun add @meridius-labs/apple-on-device-ai",
        };
      }

      // Check if Apple Intelligence is available on this device
      const isAvailable = await sdk.appleAISDK.checkAvailability();
      if (!isAvailable) {
        return {
          available: false,
          reason: "Apple Intelligence not available. Requires macOS 26+ with Apple Silicon and Apple Intelligence enabled.",
        };
      }

      return { available: true, model: "Apple Foundation Model" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { available: false, reason: `Apple AI error: ${message}` };
    }
  }

  private async loadSDK(): Promise<AppleAISDK | null> {
    try {
      const sdk = await import("@meridius-labs/apple-on-device-ai");
      return sdk as unknown as AppleAISDK;
    } catch {
      return null;
    }
  }

  async initialize(): Promise<void> {
    const sdk = await this.loadSDK();
    if (!sdk) throw new Error("Apple AI SDK not available");
    this.sdk = sdk;
  }

  // Apple AI has a limit on the number of tools it can handle effectively
  // Beyond this limit, the model returns "null" as the response
  private static readonly MAX_TOOLS = 10;

  // Apple AI has a very small context window (~9100 chars total)
  // With 10 tools (~5000 chars), we only have ~4000 chars left for messages
  // We need to aggressively limit tool result sizes
  private static readonly MAX_TOOL_RESULT_CHARS = 1500; // ~375 tokens

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.sdk) await this.initialize();

    const appleMessages = this.convertMessages(messages);
    // Only pass tools if we have them and the model should use them
    // Limit tools to MAX_TOOLS to prevent the model from returning "null"
    let appleTools: AppleAIChatOptions["tools"] | undefined;
    if (options?.tools && options.tools.length > 0) {
      const limitedTools = options.tools.slice(0, AppleAIProvider.MAX_TOOLS);
      appleTools = this.convertTools(limitedTools);
    }

    let fullContent = "";

    try {
      // IMPORTANT: When tools are provided, we must use non-streaming mode because
      // the Apple AI SDK's streaming mode returns "null" instead of tool calls.
      // We only use streaming when no tools are provided.
      const useStreaming = options?.onChunk && !appleTools;

      if (useStreaming) {
        let streamError: Error | null = null;
        const streamParser = new StreamingOutputParser();

        try {
          const streamResult = this.sdk!.chat({
            messages: appleMessages,
            stream: true,
            temperature: options?.temperature,
            maxTokens: options?.maxTokens,
          });

          // Handle async iterable for streaming
          // Use StreamingOutputParser to filter out channel tokens in real-time
          for await (const chunk of streamResult as AsyncIterable<string>) {
            fullContent += chunk;
            // Only emit clean content from the final channel (filters out analysis/commentary tokens)
            const cleanChunk = streamParser.processChunk(chunk);
            if (cleanChunk) {
              options!.onChunk!(cleanChunk);
            }
          }
        } catch (e) {
          // Capture error but continue - we may have partial content
          streamError = e instanceof Error ? e : new Error(String(e));
        }

        if (streamError && !fullContent) {
          // Re-throw if we have an error and no content
          throw streamError;
        }

        return this.createResponse(fullContent, undefined, messages);
      }

      // Non-streaming request
      let response = (await this.sdk!.chat({
        messages: appleMessages,
        tools: appleTools,
        stream: false,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
      })) as AppleAIChatResponse;

      // Check for "null" response which indicates model confusion with tools
      // Retry without tools if this happens
      if (response.text === "null" && !response.toolCalls?.length) {
        response = (await this.sdk!.chat({
          messages: appleMessages,
          stream: false,
          temperature: options?.temperature,
          maxTokens: options?.maxTokens,
        })) as AppleAIChatResponse;
      }

      return this.createResponse(response.text, response.toolCalls, messages);
    } catch (error) {
      // Handle Apple AI SDK specific errors
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("deserialize") || message.includes("Generable")) {
        // Model output parsing failed - return error as content
        throw new Error(`Apple Intelligence response error: ${message}. This may indicate the model couldn't process the request properly.`);
      }
      throw error;
    }
  }

  private createResponse(
    rawContent: string,
    sdkToolCalls: AppleAIChatResponse["toolCalls"],
    messages: Message[]
  ): ChatResponse {
    // Parse the raw content to handle models that output channel tokens
    // (e.g., <|channel|>analysis, <|channel|>commentary to=tool, <|channel|>final)
    const parsed = parseModelOutput(rawContent);
    const content = parsed.content || rawContent;

    // Combine SDK tool calls with any parsed inline tool calls from channel tokens
    const allToolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

    // Add native SDK tool calls first
    if (sdkToolCalls && sdkToolCalls.length > 0) {
      for (const tc of sdkToolCalls) {
        allToolCalls.push({
          id: tc.id ?? `call_${allToolCalls.length}`,
          type: "function" as const,
          function: tc.function,
        });
      }
    }

    // Add parsed inline tool calls from channel tokens
    if (parsed.toolCalls.length > 0) {
      for (const tc of parsed.toolCalls) {
        allToolCalls.push({
          id: `call_${allToolCalls.length}`,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        });
      }
    }

    const promptTokens = usageTracker.estimateTokens(messages.map((m) => m.content || "").join(" "));
    const completionTokens = usageTracker.estimateTokens(content);
    usageTracker.addUsage(promptTokens, completionTokens);

    // Note: Per OpenAI spec, content can be null only when tool_calls is present
    // But for user experience, we prefer empty string over null when there's no tool calls
    const hasToolCalls = allToolCalls.length > 0;
    const finalContent = hasToolCalls ? (content || null) : (content || "");

    return {
      message: {
        role: "assistant",
        content: finalContent,
        tool_calls: hasToolCalls ? allToolCalls : undefined,
      },
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  }

  private convertMessages(messages: Message[]): Array<{ role: string; content: string }> {
    // Convert messages to the simple format expected by the Apple AI SDK
    // Tool results need to be included so the model can generate a response based on them
    const result: Array<{ role: string; content: string }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content || "" });
      } else if (msg.role === "user") {
        result.push({ role: "user", content: msg.content || "" });
      } else if (msg.role === "assistant") {
        // For assistant messages with tool calls, include both the intent and tool info
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const toolInfo = msg.tool_calls
            .map((tc) => `[Calling tool: ${tc.function.name} with args: ${tc.function.arguments}]`)
            .join("\n");
          const content = msg.content ? `${msg.content}\n${toolInfo}` : toolInfo;
          result.push({ role: "assistant", content });
        } else if (msg.content) {
          result.push({ role: "assistant", content: msg.content });
        }
      } else if (msg.role === "tool") {
        // Convert tool results to user messages so the model sees them
        // Truncate long tool results to prevent context overflow
        const toolName = msg.name || "tool";
        let toolContent = msg.content || "";
        if (toolContent.length > AppleAIProvider.MAX_TOOL_RESULT_CHARS) {
          toolContent = toolContent.slice(0, AppleAIProvider.MAX_TOOL_RESULT_CHARS) +
            `\n... [truncated, ${toolContent.length - AppleAIProvider.MAX_TOOL_RESULT_CHARS} chars omitted]`;
        }
        result.push({
          role: "user",
          content: `[Tool result from ${toolName}]: ${toolContent}`,
        });
      }
    }

    return result;
  }

  private convertTools(tools: ToolDefinition[]): AppleAIChatOptions["tools"] {
    return tools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      jsonSchema: tool.function.parameters,
    }));
  }

  async shutdown(): Promise<void> {
    this.sdk = null;
  }
}

