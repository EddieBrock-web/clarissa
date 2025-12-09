/**
 * OpenAI LLM Provider
 *
 * Cloud-based provider using OpenAI's API for access to GPT models.
 */

import type { Message } from "../types.ts";
import type {
  LLMProvider,
  ProviderInfo,
  ProviderStatus,
  ChatOptions,
  ChatResponse,
} from "./types.ts";
import { usageTracker } from "../usage.ts";

// Retry configuration
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 10000,
  retryableStatusCodes: [429, 500, 502, 503, 504],
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(attempt: number): number {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, RETRY_CONFIG.maxDelayMs);
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("rate limit") || message.includes("overloaded")) {
      return true;
    }
  }
  return false;
}

// Default OpenAI models
const DEFAULT_OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4-turbo",
  "gpt-4",
  "o1",
  "o1-mini",
  "o3-mini",
] as const;

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;
  private defaultModel: string;
  private baseURL: string;

  readonly info: ProviderInfo;

  constructor(
    apiKey: string,
    defaultModel: string = "gpt-4o",
    baseURL: string = "https://api.openai.com/v1",
    customModels?: readonly string[]
  ) {
    this.apiKey = apiKey;
    this.defaultModel = defaultModel;
    this.baseURL = baseURL;
    this.info = {
      id: "openai",
      name: "OpenAI",
      description: "Cloud-based access to OpenAI GPT models",
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutput: true,
        embeddings: true,
        local: false,
      },
      availableModels: customModels ?? DEFAULT_OPENAI_MODELS,
    };
  }

  async checkAvailability(): Promise<ProviderStatus> {
    if (!this.apiKey) {
      return { available: false, reason: "No API key configured" };
    }
    return { available: true, model: this.defaultModel };
  }

  async initialize(): Promise<void> {
    // No initialization needed for OpenAI
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    const model = options?.model || this.defaultModel;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        return await this.doChat(messages, model, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < RETRY_CONFIG.maxRetries && isRetryableError(error)) {
          await sleep(getRetryDelay(attempt));
          continue;
        }
        throw lastError;
      }
    }
    throw lastError;
  }

  private async doChat(messages: Message[], model: string, options?: ChatOptions): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.tool_calls && { tool_calls: m.tool_calls }),
        ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        ...(m.name && { name: m.name }),
      })),
      stream: true,
    };

    if (options?.tools && options.tools.length > 0) {
      body.tools = options.tools;
    }
    if (options?.temperature !== undefined) {
      body.temperature = options.temperature;
    }
    if (options?.maxTokens !== undefined) {
      body.max_tokens = options.maxTokens;
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
    }

    return this.processStream(response, messages, options?.onChunk);
  }

  private async processStream(
    response: Response,
    messages: Message[],
    onChunk?: (content: string) => void
  ): Promise<ChatResponse> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let content = "";
    const toolCallsMap = new Map<number, { id: string; type: "function"; function: { name: string; arguments: string } }>();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ") || line === "data: [DONE]") continue;

        try {
          const data = JSON.parse(line.slice(6));
          const delta = data.choices?.[0]?.delta;
          if (!delta) continue;

          if (delta.content) {
            content += delta.content;
            onChunk?.(delta.content);
          }

          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const existing = toolCallsMap.get(tc.index);
              if (existing) {
                existing.function.arguments += tc.function?.arguments || "";
              } else {
                toolCallsMap.set(tc.index, {
                  id: tc.id || `call_${Date.now()}_${tc.index}`,
                  type: "function",
                  function: { name: tc.function?.name || "", arguments: tc.function?.arguments || "" },
                });
              }
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    const toolCalls = Array.from(toolCallsMap.values());
    const promptText = messages.map((m) => m.content || "").join(" ");
    const promptTokens = usageTracker.estimateTokens(promptText);
    const completionTokens = usageTracker.estimateTokens(content);
    usageTracker.addUsage(promptTokens, completionTokens);

    return {
      message: {
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      },
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseURL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: texts,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI embeddings error: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { data: { embedding: number[] }[] };
    return data.data.map((d) => d.embedding);
  }
}

