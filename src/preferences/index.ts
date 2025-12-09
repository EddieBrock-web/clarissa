/**
 * Preferences Manager
 *
 * Persists user preferences like last used provider and model.
 * These are runtime settings that override defaults but are overridden by explicit config.
 */

import { join } from "path";
import { existsSync } from "fs";
import { CONFIG_DIR } from "../config/index.ts";
import type { ProviderId } from "../llm/providers/types.ts";

const PREFERENCES_FILE = join(CONFIG_DIR, "preferences.json");

export interface Preferences {
  /** Last used LLM provider */
  lastProvider?: ProviderId;
  /** Last used model (for OpenRouter) */
  lastModel?: string;
  /** Timestamp of last update */
  updatedAt?: string;
}

/**
 * Preferences manager for persisting runtime settings
 */
class PreferencesManager {
  private preferences: Preferences = {};
  private loaded = false;

  /**
   * Load preferences from disk
   */
  async load(): Promise<Preferences> {
    if (this.loaded) return this.preferences;

    try {
      if (existsSync(PREFERENCES_FILE)) {
        const content = await Bun.file(PREFERENCES_FILE).text();
        this.preferences = JSON.parse(content) as Preferences;
      }
    } catch {
      this.preferences = {};
    }

    this.loaded = true;
    return this.preferences;
  }

  /**
   * Save preferences to disk
   */
  private async save(): Promise<void> {
    this.preferences.updatedAt = new Date().toISOString();
    await Bun.write(PREFERENCES_FILE, JSON.stringify(this.preferences, null, 2) + "\n");
  }

  /**
   * Get current preferences (loads if not already loaded)
   */
  async get(): Promise<Preferences> {
    if (!this.loaded) {
      await this.load();
    }
    return this.preferences;
  }

  /**
   * Get last used provider
   */
  async getLastProvider(): Promise<ProviderId | undefined> {
    const prefs = await this.get();
    return prefs.lastProvider;
  }

  /**
   * Set last used provider
   */
  async setLastProvider(provider: ProviderId): Promise<void> {
    await this.get(); // Ensure loaded
    this.preferences.lastProvider = provider;
    await this.save();
  }

  /**
   * Get last used model
   */
  async getLastModel(): Promise<string | undefined> {
    const prefs = await this.get();
    return prefs.lastModel;
  }

  /**
   * Set last used model
   */
  async setLastModel(model: string): Promise<void> {
    await this.get(); // Ensure loaded
    this.preferences.lastModel = model;
    await this.save();
  }

  /**
   * Update multiple preferences at once
   */
  async update(updates: Partial<Omit<Preferences, "updatedAt">>): Promise<void> {
    await this.get(); // Ensure loaded
    this.preferences = { ...this.preferences, ...updates };
    await this.save();
  }

  /**
   * Clear all preferences
   */
  async clear(): Promise<void> {
    this.preferences = {};
    this.loaded = true;
    await this.save();
  }
}

export const preferencesManager = new PreferencesManager();

