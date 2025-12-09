/**
 * LM Studio LLM Provider
 *
 * Local provider using LM Studio's native TypeScript SDK.
 * Requires LM Studio to be running with a model loaded.
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

/**
 * Parse model output that contains special channel tokens.
 * Some models (e.g., gpt-oss-20b) output structured responses with:
 * - <|channel|>analysis<|message|>...<|end|> for reasoning
 * - <|channel|>final<|message|>... for the actual response
 * - <|channel|>commentary to=<tool> <|constrain|>json<|message|>{...} for tool calls
 */
export interface ParsedOutput {
  content: string;
  toolCalls: Array<{ name: string; arguments: string }>;
}

export function parseModelOutput(rawOutput: string): ParsedOutput {
  // Check if output contains special tokens
  if (!rawOutput.includes("<|channel|>") && !rawOutput.includes("<|message|>")) {
    return { content: rawOutput, toolCalls: [] };
  }

  const toolCalls: Array<{ name: string; arguments: string }> = [];
  let finalContent = "";

  // Pattern for final channel content
  // Matches: <|channel|>final<|message|>content (until end of string or next <|)
  const finalMatch = rawOutput.match(/<\|channel\|>final<\|message\|>([\s\S]*?)(?:<\|end\|>|<\|start\|>|$)/);
  if (finalMatch && finalMatch[1] !== undefined) {
    finalContent = finalMatch[1].trim();
  }

  // Pattern for tool calls in commentary channel
  // Matches: <|channel|>commentary to=toolname <|constrain|>json<|message|>{...}
  // Also matches: <|channel|>commentary to=toolname code<|message|>{...}
  // Also matches: <|channel|>commentary to=toolname.method code<|message|>{...}
  const toolCallRegex = /<\|channel\|>commentary\s+to=([\w.]+)(?:\s+code|\s*<\|constrain\|>json)<\|message\|>(\{[\s\S]*?\})/g;
  let toolMatch;
  while ((toolMatch = toolCallRegex.exec(rawOutput)) !== null) {
    const rawToolName = toolMatch[1];
    const toolArgs = toolMatch[2];
    // Skip if match groups are undefined
    if (rawToolName === undefined || toolArgs === undefined) {
      continue;
    }
    // Normalize tool name: strip common suffixes like .run, .execute
    const toolName = rawToolName.replace(/\.(run|execute|call)$/, "");
    try {
      // Validate it's valid JSON
      JSON.parse(toolArgs);
      toolCalls.push({ name: toolName, arguments: toolArgs });
    } catch {
      // Invalid JSON, skip this tool call
    }
  }

  return { content: finalContent, toolCalls };
}

/**
 * Streaming output parser that buffers and extracts clean content.
 * Tracks channel state and only emits content from the final channel.
 */
export class StreamingOutputParser {
  private buffer = "";
  private emittedLength = 0;

  /**
   * Process incoming chunk and return any new final content to emit.
   */
  processChunk(chunk: string): string {
    this.buffer += chunk;

    // Check if we've entered the final channel
    const finalMarker = "<|channel|>final<|message|>";
    const finalIndex = this.buffer.indexOf(finalMarker);

    if (finalIndex === -1) {
      // Not in final channel yet, don't emit anything
      return "";
    }

    // We're in or past the final channel
    const contentStart = finalIndex + finalMarker.length;
    let contentEnd = this.buffer.length;

    // Check for end markers
    const endMarkers = ["<|end|>", "<|start|>", "<|channel|>"];
    for (const marker of endMarkers) {
      const markerIndex = this.buffer.indexOf(marker, contentStart);
      if (markerIndex !== -1 && markerIndex < contentEnd) {
        contentEnd = markerIndex;
      }
    }

    // Extract current final content
    const currentContent = this.buffer.slice(contentStart, contentEnd);

    // Return only the new content since last emit
    if (currentContent.length > this.emittedLength) {
      const newContent = currentContent.slice(this.emittedLength);
      this.emittedLength = currentContent.length;
      return newContent;
    }

    return "";
  }

  /**
   * Get the full parsed output at the end.
   */
  getFullOutput(): ParsedOutput {
    return parseModelOutput(this.buffer);
  }
}

// LM Studio SDK types (dynamically imported)
type LMStudioClient = {
  llm: {
    model: (identifier?: string) => Promise<LMStudioModel>;
    listLoaded: () => Promise<Array<{ identifier: string }>>;
  };
  system: {
    listDownloadedModels: () => Promise<Array<{ path: string }>>;
  };
};

type LMStudioModel = {
  identifier: string;
  respond: (
    messages: LMStudioMessage[],
    options?: LMStudioOptions
  ) => Promise<LMStudioResponse>;
};

type LMStudioMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};

type LMStudioOptions = {
  tools?: Array<{ type: "function"; function: { name: string; description: string; parameters: unknown } }>;
  onText?: (text: string) => void;
  temperature?: number;
  maxTokens?: number;
};

type LMStudioResponse = {
  content: string;
  toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>;
};

export class LMStudioProvider implements LLMProvider {
  private client: LMStudioClient | null = null;
  private model: LMStudioModel | null = null;
  private modelIdentifier: string | undefined;

  readonly info: ProviderInfo = {
    id: "lmstudio",
    name: "LM Studio",
    description: "Local LLM inference via LM Studio desktop application",
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      embeddings: true,
      local: true,
    },
    // LM Studio models are loaded dynamically, not selectable via /model
    availableModels: undefined,
  };

  constructor(modelIdentifier?: string) {
    this.modelIdentifier = modelIdentifier;
  }

  async checkAvailability(): Promise<ProviderStatus> {
    try {
      // Check if SDK is available
      const sdk = await this.loadSDK();
      if (!sdk) {
        return { available: false, reason: "LM Studio SDK not installed. Run: bun add @lmstudio/sdk" };
      }

      // First check if LM Studio is running by pinging the HTTP endpoint
      // This avoids the SDK's fancy error throwing
      const httpCheck = await fetch("http://127.0.0.1:1234/v1/models", { signal: AbortSignal.timeout(2000) })
        .then((r) => r.ok)
        .catch(() => false);

      if (!httpCheck) {
        return { available: false, reason: "LM Studio is not running" };
      }

      // Now safe to use the SDK since we know the server is up
      const client = new sdk.LMStudioClient();
      const loaded = await client.llm.listLoaded();

      const firstModel = loaded[0];
      if (!firstModel) {
        return { available: false, reason: "No models loaded in LM Studio" };
      }

      return { available: true, model: firstModel.identifier };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("ECONNREFUSED") || message.includes("fetch failed")) {
        return { available: false, reason: "LM Studio is not running" };
      }
      return { available: false, reason: `LM Studio error: ${message}` };
    }
  }

  private async loadSDK(): Promise<{ LMStudioClient: new () => LMStudioClient } | null> {
    try {
      const sdk = await import("@lmstudio/sdk");
      return sdk as { LMStudioClient: new () => LMStudioClient };
    } catch {
      return null;
    }
  }

  async initialize(): Promise<void> {
    const sdk = await this.loadSDK();
    if (!sdk) throw new Error("LM Studio SDK not available");

    this.client = new sdk.LMStudioClient();
    this.model = await this.client.llm.model(this.modelIdentifier);
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.client || !this.model) await this.initialize();

    const lmMessages = this.convertMessages(messages);
    const lmTools = options?.tools ? this.convertTools(options.tools) : undefined;

    // Use streaming parser to handle models that output special tokens
    const streamParser = new StreamingOutputParser();
    let rawContent = "";

    const response = await this.model!.respond(lmMessages, {
      tools: lmTools,
      temperature: options?.temperature,
      maxTokens: options?.maxTokens,
      onText: (text) => {
        rawContent += text;
        // Parse the chunk and only emit clean content from final channel
        const cleanChunk = streamParser.processChunk(text);
        if (cleanChunk) {
          options?.onChunk?.(cleanChunk);
        }
      },
    });

    // Parse the complete output to get clean content and any inline tool calls
    // If streaming captured content, use that; otherwise parse response.content directly
    let parsed = streamParser.getFullOutput();
    if (!parsed.content && !parsed.toolCalls.length && response.content) {
      // Streaming didn't capture anything, parse the response content directly
      parsed = parseModelOutput(response.content);
    }
    const finalContent = parsed.content || response.content || "";

    // Combine native tool calls with parsed inline tool calls
    let allToolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

    // Add native tool calls from SDK
    if (response.toolCalls && response.toolCalls.length > 0) {
      allToolCalls = response.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: tc.function,
      }));
    }

    // Add parsed inline tool calls (from special token format)
    if (parsed.toolCalls.length > 0) {
      for (const tc of parsed.toolCalls) {
        allToolCalls.push({
          id: `call_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        });
      }
    }

    const promptTokens = usageTracker.estimateTokens(messages.map((m) => m.content || "").join(" "));
    const completionTokens = usageTracker.estimateTokens(rawContent);
    usageTracker.addUsage(promptTokens, completionTokens);

    return {
      message: {
        role: "assistant",
        content: finalContent || null,
        tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
      },
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  }

  private convertMessages(messages: Message[]): LMStudioMessage[] {
    return messages.map((msg) => {
      const base: LMStudioMessage = { role: msg.role, content: msg.content || "" };
      if (msg.tool_call_id) base.toolCallId = msg.tool_call_id;
      if (msg.tool_calls) {
        base.toolCalls = msg.tool_calls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: tc.function,
        }));
      }
      return base;
    });
  }

  private convertTools(tools: ToolDefinition[]): LMStudioOptions["tools"] {
    return tools.map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    }));
  }

  async shutdown(): Promise<void> {
    this.client = null;
    this.model = null;
  }
}

