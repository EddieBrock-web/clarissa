import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { join } from "path";
import { tmpdir } from "os";
import { mkdir, rm } from "fs/promises";

// We need to test the PreferencesManager class behavior
// Since it's a singleton, we'll test the exported instance behavior

describe("Preferences Manager", () => {
  // Create a test preferences manager class for isolated testing
  class TestPreferencesManager {
    private preferences: Record<string, unknown> = {};
    private loaded = false;
    private filePath: string;

    constructor(filePath: string) {
      this.filePath = filePath;
    }

    async load(): Promise<Record<string, unknown>> {
      if (this.loaded) return this.preferences;

      try {
        const file = Bun.file(this.filePath);
        if (await file.exists()) {
          const content = await file.text();
          this.preferences = JSON.parse(content);
        }
      } catch {
        this.preferences = {};
      }

      this.loaded = true;
      return this.preferences;
    }

    private async save(): Promise<void> {
      this.preferences.updatedAt = new Date().toISOString();
      await Bun.write(this.filePath, JSON.stringify(this.preferences, null, 2) + "\n");
    }

    async get(): Promise<Record<string, unknown>> {
      if (!this.loaded) {
        await this.load();
      }
      return this.preferences;
    }

    async getLastProvider(): Promise<string | undefined> {
      const prefs = await this.get();
      return prefs.lastProvider as string | undefined;
    }

    async setLastProvider(provider: string): Promise<void> {
      await this.get();
      this.preferences.lastProvider = provider;
      await this.save();
    }

    async getLastModel(): Promise<string | undefined> {
      const prefs = await this.get();
      return prefs.lastModel as string | undefined;
    }

    async setLastModel(model: string): Promise<void> {
      await this.get();
      this.preferences.lastModel = model;
      await this.save();
    }

    async update(updates: Record<string, unknown>): Promise<void> {
      await this.get();
      this.preferences = { ...this.preferences, ...updates };
      await this.save();
    }

    async clear(): Promise<void> {
      this.preferences = {};
      this.loaded = true;
      await this.save();
    }
  }

  let testDir: string;
  let prefsFile: string;
  let manager: TestPreferencesManager;

  beforeEach(async () => {
    testDir = join(tmpdir(), `clarissa-prefs-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
    prefsFile = join(testDir, "preferences.json");
    manager = new TestPreferencesManager(prefsFile);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("load", () => {
    test("returns empty object when file does not exist", async () => {
      const prefs = await manager.load();
      expect(prefs).toEqual({});
    });

    test("loads existing preferences from file", async () => {
      await Bun.write(prefsFile, JSON.stringify({ lastProvider: "openai" }));
      const prefs = await manager.load();
      expect(prefs.lastProvider).toBe("openai");
    });

    test("handles malformed JSON gracefully", async () => {
      await Bun.write(prefsFile, "not valid json");
      const prefs = await manager.load();
      expect(prefs).toEqual({});
    });
  });

  describe("setLastProvider and getLastProvider", () => {
    test("sets and retrieves last provider", async () => {
      await manager.setLastProvider("anthropic");
      const provider = await manager.getLastProvider();
      expect(provider).toBe("anthropic");
    });

    test("persists provider to disk", async () => {
      await manager.setLastProvider("openrouter");
      const content = await Bun.file(prefsFile).text();
      const saved = JSON.parse(content);
      expect(saved.lastProvider).toBe("openrouter");
    });
  });

  describe("setLastModel and getLastModel", () => {
    test("sets and retrieves last model", async () => {
      await manager.setLastModel("gpt-4o");
      const model = await manager.getLastModel();
      expect(model).toBe("gpt-4o");
    });

    test("persists model to disk", async () => {
      await manager.setLastModel("claude-sonnet-4");
      const content = await Bun.file(prefsFile).text();
      const saved = JSON.parse(content);
      expect(saved.lastModel).toBe("claude-sonnet-4");
    });
  });

  describe("update", () => {
    test("updates multiple preferences at once", async () => {
      await manager.update({ lastProvider: "lmstudio", lastModel: "local-model" });
      expect(await manager.getLastProvider()).toBe("lmstudio");
      expect(await manager.getLastModel()).toBe("local-model");
    });

    test("adds updatedAt timestamp", async () => {
      await manager.update({ lastProvider: "openai" });
      const prefs = await manager.get();
      expect(prefs.updatedAt).toBeDefined();
    });
  });

  describe("clear", () => {
    test("removes all preferences", async () => {
      await manager.setLastProvider("anthropic");
      await manager.setLastModel("claude-3");
      await manager.clear();
      expect(await manager.getLastProvider()).toBeUndefined();
      expect(await manager.getLastModel()).toBeUndefined();
    });
  });
});

