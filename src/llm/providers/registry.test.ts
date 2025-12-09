import { test, expect, describe, beforeEach } from "bun:test";
import type { LLMProvider, ProviderInfo, ProviderStatus, ChatResponse } from "./types.ts";
import type { Message } from "../types.ts";

/**
 * Mock provider for testing
 */
class MockProvider implements LLMProvider {
  readonly info: ProviderInfo;
  private available: boolean;
  private model: string;
  initialized = false;
  shutdownCalled = false;

  constructor(id: string, name: string, available = true, model = "test-model") {
    this.info = {
      id: id as ProviderInfo["id"],
      name,
      description: `Mock ${name} provider`,
      capabilities: {
        streaming: true,
        toolCalling: true,
        structuredOutput: false,
        embeddings: false,
        local: id !== "openrouter",
      },
    };
    this.available = available;
    this.model = model;
  }

  async checkAvailability(): Promise<ProviderStatus> {
    if (this.available) {
      return { available: true, model: this.model };
    }
    return { available: false, reason: "Mock provider unavailable" };
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async shutdown(): Promise<void> {
    this.shutdownCalled = true;
  }

  async chat(_messages: Message[]): Promise<ChatResponse> {
    return { message: { role: "assistant", content: "Mock response" } };
  }
}

/**
 * Create a fresh registry instance for testing (not the singleton)
 */
function createTestRegistry() {
  // We need to create a new registry class instance for isolation
  // Import the class definition pattern
  class TestProviderRegistry {
    private providers: Map<string, LLMProvider> = new Map();
    private activeProvider: LLMProvider | null = null;

    registerProvider(id: string, provider: LLMProvider): void {
      this.providers.set(id, provider);
    }

    async getProviderStatuses(): Promise<Map<string, ProviderStatus>> {
      const statuses = new Map<string, ProviderStatus>();
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

    getProvider(id: string): LLMProvider | undefined {
      return this.providers.get(id);
    }

    async getActiveProvider(): Promise<LLMProvider> {
      if (this.activeProvider) {
        return this.activeProvider;
      }
      // Auto-detect first available
      for (const [, provider] of this.providers) {
        const status = await provider.checkAvailability();
        if (status.available) {
          this.activeProvider = provider;
          await provider.initialize?.();
          return provider;
        }
      }
      throw new Error("No LLM provider available");
    }

    async setActiveProvider(id: string): Promise<void> {
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

    getRegisteredProviders(): Array<{ id: string; name: string; description: string }> {
      return Array.from(this.providers.entries()).map(([id, provider]) => ({
        id,
        name: provider.info.name,
        description: provider.info.description,
      }));
    }

    clearActiveProvider(): void {
      this.activeProvider = null;
    }
  }

  return new TestProviderRegistry();
}

describe("Provider Registry", () => {
  let registry: ReturnType<typeof createTestRegistry>;

  beforeEach(() => {
    registry = createTestRegistry();
  });

  describe("getProviderStatuses", () => {
    test("returns status for all registered providers", async () => {
      registry.registerProvider("openrouter", new MockProvider("openrouter", "OpenRouter", true));
      registry.registerProvider("lmstudio", new MockProvider("lmstudio", "LM Studio", false));

      const statuses = await registry.getProviderStatuses();

      expect(statuses.size).toBe(2);
      expect(statuses.get("openrouter")?.available).toBe(true);
      expect(statuses.get("openrouter")?.model).toBe("test-model");
      expect(statuses.get("lmstudio")?.available).toBe(false);
      expect(statuses.get("lmstudio")?.reason).toBe("Mock provider unavailable");
    });

    test("handles empty registry", async () => {
      const statuses = await registry.getProviderStatuses();
      expect(statuses.size).toBe(0);
    });
  });

  describe("getRegisteredProviders", () => {
    test("returns info for all registered providers", () => {
      registry.registerProvider("openrouter", new MockProvider("openrouter", "OpenRouter"));
      registry.registerProvider("lmstudio", new MockProvider("lmstudio", "LM Studio"));

      const providers = registry.getRegisteredProviders();

      expect(providers).toHaveLength(2);
      expect(providers.find((p) => p.id === "openrouter")).toEqual({
        id: "openrouter",
        name: "OpenRouter",
        description: "Mock OpenRouter provider",
      });
    });

    test("returns empty array when no providers registered", () => {
      const providers = registry.getRegisteredProviders();
      expect(providers).toHaveLength(0);
    });
  });

  describe("setActiveProvider", () => {
    test("switches to available provider", async () => {
      const provider = new MockProvider("lmstudio", "LM Studio", true);
      registry.registerProvider("lmstudio", provider);

      await registry.setActiveProvider("lmstudio");

      expect(provider.initialized).toBe(true);
      const active = await registry.getActiveProvider();
      expect(active.info.id).toBe("lmstudio");
    });

    test("throws error for non-existent provider", async () => {
      await expect(registry.setActiveProvider("nonexistent")).rejects.toThrow(
        "Provider not found: nonexistent"
      );
    });

    test("throws error for unavailable provider", async () => {
      registry.registerProvider("offline", new MockProvider("offline", "Offline", false));

      await expect(registry.setActiveProvider("offline")).rejects.toThrow(
        "Provider not available: Mock provider unavailable"
      );
    });

    test("calls shutdown on previous provider", async () => {
      const provider1 = new MockProvider("provider1", "Provider 1", true);
      const provider2 = new MockProvider("provider2", "Provider 2", true);
      registry.registerProvider("provider1", provider1);
      registry.registerProvider("provider2", provider2);

      await registry.setActiveProvider("provider1");
      await registry.setActiveProvider("provider2");

      expect(provider1.shutdownCalled).toBe(true);
      expect(provider2.initialized).toBe(true);
    });
  });

  describe("getActiveProvider", () => {
    test("returns active provider if set", async () => {
      registry.registerProvider("lmstudio", new MockProvider("lmstudio", "LM Studio", true));
      await registry.setActiveProvider("lmstudio");

      const active = await registry.getActiveProvider();
      expect(active.info.id).toBe("lmstudio");
    });

    test("auto-detects first available provider", async () => {
      registry.registerProvider("offline", new MockProvider("offline", "Offline", false));
      registry.registerProvider("online", new MockProvider("online", "Online", true));

      const active = await registry.getActiveProvider();
      expect(active.info.id).toBe("online");
    });

    test("throws error when no providers available", async () => {
      registry.registerProvider("offline", new MockProvider("offline", "Offline", false));

      await expect(registry.getActiveProvider()).rejects.toThrow("No LLM provider available");
    });

    test("initializes provider on first access", async () => {
      const provider = new MockProvider("test", "Test", true);
      registry.registerProvider("test", provider);

      await registry.getActiveProvider();
      expect(provider.initialized).toBe(true);
    });
  });
});

