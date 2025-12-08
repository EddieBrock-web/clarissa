import { join } from "path";
import { existsSync } from "fs";
import { CONFIG_DIR } from "../config/index.ts";

const HISTORY_FILE = join(CONFIG_DIR, "history.json");
const MAX_HISTORY_ENTRIES = 100;

export interface HistoryEntry {
  query: string;
  response: string;
  model: string;
  timestamp: string;
}

interface HistoryData {
  entries: HistoryEntry[];
}

/**
 * History manager for persisting one-shot queries
 */
class HistoryManager {
  private entries: HistoryEntry[] = [];
  private loaded = false;

  /**
   * Load history from disk
   */
  private async load(): Promise<void> {
    if (this.loaded) return;

    try {
      if (existsSync(HISTORY_FILE)) {
        const data: HistoryData = JSON.parse(
          await Bun.file(HISTORY_FILE).text()
        );
        this.entries = data.entries || [];
      }
    } catch {
      this.entries = [];
    }

    this.loaded = true;
  }

  /**
   * Save history to disk
   */
  private async save(): Promise<void> {
    const data: HistoryData = { entries: this.entries };
    await Bun.write(HISTORY_FILE, JSON.stringify(data, null, 2) + "\n");
  }

  /**
   * Add a new history entry
   */
  async add(query: string, response: string, model: string): Promise<void> {
    await this.load();

    const entry: HistoryEntry = {
      query: query.trim(),
      response: response.trim(),
      model,
      timestamp: new Date().toISOString(),
    };

    this.entries.unshift(entry);

    // Keep only the most recent entries
    if (this.entries.length > MAX_HISTORY_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_HISTORY_ENTRIES);
    }

    await this.save();
  }

  /**
   * Get all history entries
   */
  async list(): Promise<HistoryEntry[]> {
    await this.load();
    return [...this.entries];
  }

  /**
   * Get recent entries
   */
  async getRecent(count: number = 10): Promise<HistoryEntry[]> {
    await this.load();
    return this.entries.slice(0, count);
  }

  /**
   * Clear all history
   */
  async clear(): Promise<void> {
    this.entries = [];
    await this.save();
  }
}

export const historyManager = new HistoryManager();

