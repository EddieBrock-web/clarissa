/**
 * LLM Provider Registry
 *
 * Manages provider registration, auto-detection, and fallback logic.
 * Providers are tried in priority order until one is available.
 */

import type { LLMProvider, ProviderStatus, ProviderId } from "./types.ts";
import { OpenRouterProvider } from "./openrouter.ts";
import { OpenAIProvider } from "./openai.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { LMStudioProvider } from "./lmstudio.ts";
import { LocalLlamaProvider, type LocalLlamaConfig } from "./local-llama.ts";
import { AppleAIProvider } from "./apple-ai.ts";

export interface ProviderConfig {
  /** OpenRouter API key (for cloud provider) */
  openrouterApiKey?: string;
  /** OpenRouter model to use */
  openrouterModel?: string;
  /** Custom OpenRouter model list */
  openrouterModels?: readonly string[];
  /** OpenAI API key */
  openaiApiKey?: string;
  /** OpenAI model to use */
  openaiModel?: string;
  /** Custom OpenAI model list */
  openaiModels?: readonly string[];
  /** Anthropic API key */
  anthropicApiKey?: string;
  /** Anthropic model to use */
  anthropicModel?: string;
  /** Custom Anthropic model list */
  anthropicModels?: readonly string[];
  /** LM Studio model identifier */
  lmstudioModel?: string;
  /** Path to local GGUF model file (legacy, use localLlamaConfig instead) */
  localModelPath?: string;
  /** Full local-llama configuration */
  localLlamaConfig?: LocalLlamaConfig;
  /** Preferred provider (skips auto-detection) */
  preferredProvider?: ProviderId;
}

export interface ProviderDetectionResult {
  provider: LLMProvider;
  status: ProviderStatus;
}

/**
 * Registry for managing LLM providers
 */
class ProviderRegistry {
  private providers: Map<ProviderId, LLMProvider> = new Map();
  private activeProvider: LLMProvider | null = null;
  private config: ProviderConfig = {};

  /**
   * Configure the registry with provider settings
   */
  configure(config: ProviderConfig): void {
    this.config = config;
    this.providers.clear();
    this.activeProvider = null;

    // Register cloud providers based on config
    if (config.openrouterApiKey) {
      this.providers.set(
        "openrouter",
        new OpenRouterProvider(
          config.openrouterApiKey,
          config.openrouterModel,
          config.openrouterModels
        )
      );
    }

    if (config.openaiApiKey) {
      this.providers.set(
        "openai",
        new OpenAIProvider(
          config.openaiApiKey,
          config.openaiModel,
          undefined, // baseURL
          config.openaiModels
        )
      );
    }

    if (config.anthropicApiKey) {
      this.providers.set(
        "anthropic",
        new AnthropicProvider(
          config.anthropicApiKey,
          config.anthropicModel,
          config.anthropicModels
        )
      );
    }

    // Always register local providers (they'll check availability at runtime)
    this.providers.set("lmstudio", new LMStudioProvider(config.lmstudioModel));

    // Register Apple AI provider (macOS only, checks availability at runtime)
    this.providers.set("apple-ai", new AppleAIProvider());

    // Register local-llama with full config or legacy path
    const localLlamaConfig = config.localLlamaConfig ??
      (config.localModelPath ? { modelPath: config.localModelPath } : undefined);

    if (localLlamaConfig) {
      this.providers.set("local-llama", new LocalLlamaProvider(localLlamaConfig));
    }
  }

  /**
   * Get all registered providers with their status
   */
  async getProviderStatuses(): Promise<Map<ProviderId, ProviderStatus>> {
    const statuses = new Map<ProviderId, ProviderStatus>();

    for (const [id, provider] of this.providers) {
      try {
        statuses.set(id, await provider.checkAvailability());
      } catch (error) {
        statuses.set(id, {
          available: false,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return statuses;
  }

  /**
   * Auto-detect the best available provider
   * Tries providers in priority order until one is available
   */
  async detectProvider(): Promise<ProviderDetectionResult | null> {
    // If preferred provider is set, try it first
    if (this.config.preferredProvider) {
      const preferred = this.providers.get(this.config.preferredProvider);
      if (preferred) {
        const status = await preferred.checkAvailability();
        if (status.available) {
          return { provider: preferred, status };
        }
      }
    }

    // Priority order: openrouter > openai > anthropic > apple-ai > lmstudio > local-llama
    const priorityOrder: ProviderId[] = ["openrouter", "openai", "anthropic", "apple-ai", "lmstudio", "local-llama"];

    for (const id of priorityOrder) {
      const provider = this.providers.get(id);
      if (!provider) continue;

      try {
        const status = await provider.checkAvailability();
        if (status.available) {
          return { provider, status };
        }
      } catch {
        // Provider check failed, try next
        continue;
      }
    }

    return null;
  }

  /**
   * Get a specific provider by ID
   */
  getProvider(id: ProviderId): LLMProvider | undefined {
    return this.providers.get(id);
  }

  /**
   * Get the currently active provider
   * Auto-detects if not already set
   */
  async getActiveProvider(): Promise<LLMProvider> {
    if (this.activeProvider) {
      return this.activeProvider;
    }

    const result = await this.detectProvider();
    if (!result) {
      throw new Error(
        "No LLM provider available. Please configure an API key or start a local LLM server."
      );
    }

    this.activeProvider = result.provider;
    await this.activeProvider.initialize?.();
    return this.activeProvider;
  }

  /**
   * Set the active provider manually
   */
  async setActiveProvider(id: ProviderId): Promise<void> {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Provider not found: ${id}`);
    }

    const status = await provider.checkAvailability();
    if (!status.available) {
      throw new Error(`Provider not available: ${status.reason}`);
    }

    if (this.activeProvider?.shutdown) {
      await this.activeProvider.shutdown();
    }

    this.activeProvider = provider;
    await provider.initialize?.();
  }

  /**
   * Get info about all registered providers
   */
  getRegisteredProviders(): Array<{ id: ProviderId; name: string; description: string }> {
    return Array.from(this.providers.entries()).map(([id, provider]) => ({
      id,
      name: provider.info.name,
      description: provider.info.description,
    }));
  }

  /**
   * Get the ID of the currently active provider
   */
  getActiveProviderId(): ProviderId | null {
    if (!this.activeProvider) return null;
    for (const [id, provider] of this.providers) {
      if (provider === this.activeProvider) return id;
    }
    return null;
  }

  /**
   * Get available models for the active provider
   * Returns undefined if provider has no selectable models
   */
  getAvailableModels(): readonly string[] | undefined {
    return this.activeProvider?.info.availableModels;
  }

  /**
   * Shutdown the active provider (unload models, cleanup resources)
   */
  async shutdown(): Promise<void> {
    if (this.activeProvider?.shutdown) {
      await this.activeProvider.shutdown();
    }
    this.activeProvider = null;
  }
}

export const providerRegistry = new ProviderRegistry();

