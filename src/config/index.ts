import { z } from "zod";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".clarissa");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * MCP server configuration schema (standard MCP JSON format)
 */
const mcpServerSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type MCPServerFileConfig = z.infer<typeof mcpServerSchema>;

/**
 * Config file schema
 */
const configFileSchema = z.object({
  apiKey: z.string().min(1).optional(),
  model: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  debug: z.boolean().optional(),
  mcpServers: z.record(z.string(), mcpServerSchema).optional(),
});

type ConfigFile = z.infer<typeof configFileSchema>;

// Store loaded MCP servers config for access by other modules
let loadedMcpServers: Record<string, MCPServerFileConfig> = {};

/**
 * Get configured MCP servers from config file
 */
export function getMcpServers(): Record<string, MCPServerFileConfig> {
  return loadedMcpServers;
}

/**
 * Environment configuration schema with Zod validation
 */
const envSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1, "OPENROUTER_API_KEY is required"),
  OPENROUTER_MODEL: z
    .string()
    .default("anthropic/claude-sonnet-4"),
  APP_NAME: z.string().default("Clarissa"),
  APP_URL: z.string().url().optional(),
  MAX_ITERATIONS: z.coerce.number().int().positive().default(10),
  DEBUG: z
    .string()
    .optional()
    .default("false")
    .transform((val) => val === "true" || val === "1"),
});

export type EnvConfig = z.infer<typeof envSchema>;

/**
 * Check if we're running in a test environment
 */
const isTestEnv = process.env.NODE_ENV === "test" || typeof Bun !== "undefined" && Bun.env.BUN_ENV === "test" || process.argv.some(arg => arg.includes("bun") && arg.includes("test"));

/**
 * Load config from ~/.clarissa/config.json
 */
function loadConfigFile(): ConfigFile | null {
  try {
    const file = Bun.file(CONFIG_FILE);
    if (!file.size) return null;
    const content = require(CONFIG_FILE);
    const result = configFileSchema.safeParse(content);
    if (result.success) {
      // Store MCP servers for later access
      loadedMcpServers = result.data.mcpServers || {};
      return result.data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Show setup instructions when API key is missing
 */
function showSetupInstructions(): never {
  console.error(`
Missing API key. To get started:

1. Get an API key from https://openrouter.ai/keys

2. Create config file at ${CONFIG_FILE}:

   mkdir -p ${CONFIG_DIR}
   echo '{"apiKey": "your_api_key_here"}' > ${CONFIG_FILE}

   Or set as environment variable:

   export OPENROUTER_API_KEY=your_api_key_here
`);
  process.exit(1);
}

/**
 * Validate and parse environment variables
 */
function loadConfig(): EnvConfig {
  // In test environment, use defaults if API key not provided
  if (isTestEnv && !process.env.OPENROUTER_API_KEY) {
    return {
      OPENROUTER_API_KEY: "test-api-key",
      OPENROUTER_MODEL: "anthropic/claude-sonnet-4",
      APP_NAME: "Clarissa",
      APP_URL: undefined,
      MAX_ITERATIONS: 10,
      DEBUG: false,
    };
  }

  // Load config file and merge with environment
  const fileConfig = loadConfigFile();

  const mergedEnv = {
    ...process.env,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY || fileConfig?.apiKey,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL || fileConfig?.model,
    MAX_ITERATIONS: process.env.MAX_ITERATIONS || fileConfig?.maxIterations?.toString(),
    DEBUG: process.env.DEBUG || (fileConfig?.debug ? "true" : undefined),
  };

  const result = envSchema.safeParse(mergedEnv);

  if (!result.success) {
    showSetupInstructions();
  }

  return result.data;
}

export const config = loadConfig();

// Popular models available on OpenRouter
export const AVAILABLE_MODELS = [
  "anthropic/claude-sonnet-4",
  "anthropic/claude-opus-4",
  "anthropic/claude-3.5-sonnet",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "google/gemini-2.0-flash",
  "google/gemini-2.5-pro-preview",
  "meta-llama/llama-3.3-70b-instruct",
  "deepseek/deepseek-chat-v3-0324",
] as const;

/**
 * Agent configuration class with mutable state
 */
class AgentConfig {
  model: string;
  readonly maxIterations: number;
  readonly appName: string;
  readonly debug: boolean;
  autoApprove: boolean;

  constructor() {
    this.model = config.OPENROUTER_MODEL;
    this.maxIterations = config.MAX_ITERATIONS;
    this.appName = config.APP_NAME;
    this.debug = config.DEBUG;
    this.autoApprove = false;
  }

  /**
   * Change the current model
   */
  setModel(model: string): void {
    this.model = model;
  }

  /**
   * Toggle auto-approve mode
   */
  toggleAutoApprove(): boolean {
    this.autoApprove = !this.autoApprove;
    return this.autoApprove;
  }
}

export const agentConfig = new AgentConfig();

