/**
 * Local Llama (node-llama-cpp) Provider
 *
 * Direct local LLM inference using node-llama-cpp bindings.
 * No external server required - runs inference in-process.
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
 * Configuration options for LocalLlamaProvider
 */
export interface LocalLlamaConfig {
  /** Path to the GGUF model file */
  modelPath: string;
  /** Number of layers to offload to GPU (-1 for auto, 0 for CPU-only) */
  gpuLayers?: number;
  /** Context window size in tokens */
  contextSize?: number;
  /** Batch size for prompt processing */
  batchSize?: number;
  /** Enable flash attention for faster inference */
  flashAttention?: boolean;
}

// node-llama-cpp SDK type (dynamically imported)
type NodeLlamaCppSDK = {
  getLlama: () => Promise<Llama>;
  LlamaChatSession: new (options: LlamaChatSessionOptions) => LlamaChatSession;
  defineChatSessionFunction: (def: {
    description: string;
    params: unknown;
    handler: (params: Record<string, unknown>) => Promise<unknown>;
  }) => LlamaFunction;
};

// Llama instance type
type Llama = {
  loadModel: (options: LlamaModelOptions) => Promise<LlamaModel>;
};

type LlamaModelOptions = {
  modelPath: string;
  gpuLayers?: number | "auto";
  onLoadProgress?: (progress: number) => void;
};

type LlamaModel = {
  createContext: (options?: LlamaContextOptions) => Promise<LlamaContext>;
  createEmbeddingContext: () => Promise<LlamaEmbeddingContext>;
};

type LlamaContextOptions = {
  contextSize?: number;
  batchSize?: number;
  flashAttention?: boolean;
};

type LlamaContext = {
  getSequence: () => LlamaSequence;
  dispose: () => Promise<void>;
  contextSize: number;
  getState?: () => { usedSize: number; contextSize: number };
};

type LlamaSequence = unknown;

type LlamaChatSessionOptions = {
  contextSequence: LlamaSequence;
  systemPrompt?: string;
};

type LlamaChatSession = {
  prompt: (
    text: string,
    options?: LlamaChatPromptOptions
  ) => Promise<string>;
};

type LlamaChatPromptOptions = {
  functions?: Record<string, LlamaFunction>;
  onTextChunk?: (text: string) => void;
  temperature?: number;
  maxTokens?: number;
};

type LlamaFunction = {
  description: string;
  params: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  handler: (params: Record<string, unknown>) => Promise<unknown>;
};

type LlamaEmbeddingContext = {
  getEmbeddingFor: (text: string) => Promise<{ vector: number[] }>;
  dispose: () => Promise<void>;
};

// Module-level model cache for reuse across provider instances
const modelCache = new Map<string, { model: LlamaModel; refCount: number }>();

export class LocalLlamaProvider implements LLMProvider {
  private sdk: NodeLlamaCppSDK | null = null;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaContext | null = null;
  private session: LlamaChatSession | null = null;
  private config: LocalLlamaConfig;
  private systemPrompt: string | null = null;

  // Store pending function calls for the current chat
  private pendingToolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

  readonly info: ProviderInfo = {
    id: "local-llama",
    name: "Local Llama",
    description: "Direct local LLM inference using node-llama-cpp (GGUF models)",
    capabilities: {
      streaming: true,
      toolCalling: true,
      structuredOutput: true,
      embeddings: true,
      local: true,
    },
    // Local-llama uses a configured model path, not selectable via /model
    availableModels: undefined,
  };

  constructor(config: LocalLlamaConfig) {
    this.config = config;
  }

  async checkAvailability(): Promise<ProviderStatus> {
    // Check if SDK is available
    const sdk = await this.loadSDK();
    if (!sdk) {
      return { available: false, reason: "node-llama-cpp not installed. Run: bun add node-llama-cpp" };
    }

    // Check if model file exists and get file info
    try {
      const file = Bun.file(this.config.modelPath);
      const exists = await file.exists();
      if (!exists) {
        return { available: false, reason: `Model file not found: ${this.config.modelPath}` };
      }

      // Get file size for memory estimation
      const fileSize = file.size;
      const fileSizeMB = Math.ceil(fileSize / (1024 * 1024));
      // Rough estimate: GGUF models need ~1.2x file size in RAM (varies by quantization)
      const estimatedMemoryMB = Math.ceil(fileSizeMB * 1.2);

      return {
        available: true,
        model: this.config.modelPath,
        metadata: {
          fileSizeMB,
          estimatedMemoryMB,
          contextSize: this.config.contextSize,
        },
      };
    } catch (error) {
      return { available: false, reason: `Error checking model: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async loadSDK(): Promise<NodeLlamaCppSDK | null> {
    if (this.sdk) return this.sdk;

    try {
      const sdk = await import("node-llama-cpp");
      this.sdk = sdk as unknown as NodeLlamaCppSDK;
      return this.sdk;
    } catch {
      return null;
    }
  }

  async initialize(onProgress?: (progress: number) => void): Promise<void> {
    const sdk = await this.loadSDK();
    if (!sdk) throw new Error("node-llama-cpp not available");

    // Check if model is already cached
    const cached = modelCache.get(this.config.modelPath);
    if (cached) {
      cached.refCount++;
      this.model = cached.model;
    } else {
      // Load llama instance
      this.llama = await sdk.getLlama();

      // Load model with configuration
      this.model = await this.llama.loadModel({
        modelPath: this.config.modelPath,
        gpuLayers: this.config.gpuLayers === -1 ? "auto" : this.config.gpuLayers,
        onLoadProgress: onProgress,
      });

      // Cache the model for reuse
      modelCache.set(this.config.modelPath, { model: this.model, refCount: 1 });
    }

    // Create context with configuration (lightweight, always create new)
    this.context = await this.model.createContext({
      contextSize: this.config.contextSize,
      batchSize: this.config.batchSize,
      flashAttention: this.config.flashAttention,
    });

    // Session will be created on first chat to include system prompt
    this.session = null;
  }

  /**
   * Create or reset the chat session with the current system prompt
   */
  private createSession(): void {
    if (!this.sdk || !this.context) {
      throw new Error("Provider not initialized");
    }

    this.session = new this.sdk.LlamaChatSession({
      contextSequence: this.context.getSequence(),
      systemPrompt: this.systemPrompt ?? undefined,
    });
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<ChatResponse> {
    if (!this.context) await this.initialize();

    // Extract system prompt and check if it changed
    const { systemPrompt, conversationPrompt } = this.buildPrompt(messages);

    // Create or recreate session if system prompt changed
    if (!this.session || this.systemPrompt !== systemPrompt) {
      this.systemPrompt = systemPrompt;
      this.createSession();
    }

    this.pendingToolCalls = [];

    // Convert tools to node-llama-cpp functions
    const functions = options?.tools ? await this.convertTools(options.tools) : undefined;

    let fullContent = "";

    try {
      const response = await this.session!.prompt(conversationPrompt, {
        functions,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        onTextChunk: (text) => {
          fullContent += text;
          options?.onChunk?.(text);
        },
      });

      // Estimate tokens for usage tracking
      const allMessagesText = messages.map(m => m.content || "").join(" ");
      const promptTokens = usageTracker.estimateTokens(allMessagesText);
      const completionTokens = usageTracker.estimateTokens(response);
      usageTracker.addUsage(promptTokens, completionTokens);

      return {
        message: {
          role: "assistant",
          content: fullContent || response || null,
          tool_calls: this.pendingToolCalls.length > 0 ? this.pendingToolCalls : undefined,
        },
        usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
      };
    } catch (error) {
      // Handle common error scenarios with helpful messages
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.toLowerCase().includes("context") || errorMessage.toLowerCase().includes("overflow")) {
        throw new Error("Context window exceeded. Try a shorter conversation or increase contextSize in config.");
      }
      if (errorMessage.toLowerCase().includes("memory") || errorMessage.toLowerCase().includes("alloc")) {
        throw new Error("Insufficient memory for model. Try reducing gpuLayers to 0 for CPU-only mode.");
      }
      if (errorMessage.toLowerCase().includes("cuda") || errorMessage.toLowerCase().includes("gpu")) {
        throw new Error("GPU error occurred. Try setting gpuLayers to 0 in config for CPU-only mode.");
      }

      throw error;
    }
  }

  /**
   * Build prompt from messages, separating system prompt from conversation
   */
  private buildPrompt(messages: Message[]): { systemPrompt: string | null; conversationPrompt: string } {
    let systemPrompt: string | null = null;
    const conversationParts: string[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        // Collect all system messages (typically just one at the start)
        systemPrompt = (systemPrompt ? systemPrompt + "\n\n" : "") + (msg.content || "");
      } else if (msg.role === "user") {
        conversationParts.push(`User: ${msg.content || ""}`);
      } else if (msg.role === "assistant") {
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          // Include tool call info for context
          const toolInfo = msg.tool_calls.map(tc => `[Called: ${tc.function.name}]`).join(" ");
          conversationParts.push(`Assistant: ${msg.content || ""} ${toolInfo}`);
        } else {
          conversationParts.push(`Assistant: ${msg.content || ""}`);
        }
      } else if (msg.role === "tool") {
        conversationParts.push(`Tool (${msg.name}): ${msg.content || ""}`);
      }
    }

    // For LlamaChatSession, we send the last part of the conversation
    // The session maintains its own history, so we build a combined prompt
    // that provides context for multi-turn conversations
    const conversationPrompt = conversationParts.join("\n\n");

    return { systemPrompt, conversationPrompt };
  }

  private async convertTools(
    tools: ToolDefinition[]
  ): Promise<Record<string, LlamaFunction>> {
    const sdk = await this.loadSDK();
    if (!sdk) return {};

    const functions: Record<string, LlamaFunction> = {};
    let callIndex = 0;

    for (const tool of tools) {
      functions[tool.function.name] = sdk.defineChatSessionFunction({
        description: tool.function.description,
        params: tool.function.parameters,
        handler: async (params) => {
          // Record the tool call for later execution
          const callId = `call_${Date.now()}_${callIndex++}`;
          this.pendingToolCalls.push({
            id: callId,
            type: "function",
            function: {
              name: tool.function.name,
              arguments: JSON.stringify(params),
            },
          });
          // Return placeholder - actual execution happens in agent
          return { pending: true, callId };
        },
      });
    }

    return functions;
  }

  /**
   * Generate embeddings for the given texts
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (!this.model) await this.initialize();

    const embeddingContext = await this.model!.createEmbeddingContext();
    const embeddings: number[][] = [];

    try {
      for (const text of texts) {
        const embedding = await embeddingContext.getEmbeddingFor(text);
        embeddings.push(embedding.vector);
      }
    } finally {
      await embeddingContext.dispose();
    }

    return embeddings;
  }

  async shutdown(): Promise<void> {
    // Dispose context
    if (this.context) {
      await this.context.dispose();
    }
    this.context = null;
    this.session = null;

    // Decrease model refcount and potentially remove from cache
    if (this.model) {
      const cached = modelCache.get(this.config.modelPath);
      if (cached) {
        cached.refCount--;
        if (cached.refCount <= 0) {
          modelCache.delete(this.config.modelPath);
        }
      }
    }

    this.model = null;
    this.llama = null;
    this.sdk = null;
  }
}

