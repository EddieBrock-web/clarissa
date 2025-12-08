#!/usr/bin/env bun
import { render } from "ink";
import { AppWithErrorBoundary, AppWithSession } from "./ui/App.tsx";
import { Agent } from "./agent.ts";
import { agentConfig, AVAILABLE_MODELS, initConfig, CONFIG_FILE, CONFIG_DIR } from "./config/index.ts";
import { checkForUpdates, runUpgrade, runCheckUpdate, CURRENT_VERSION, PACKAGE_NAME } from "./update.ts";
import { sessionManager } from "./session/index.ts";
import { historyManager } from "./history/index.ts";
import * as readline from "readline";
import { existsSync } from "fs";

const VERSION = CURRENT_VERSION;
const NAME = PACKAGE_NAME;

function printVersion() {
  console.log(`${NAME} v${VERSION}`);
}

function printHelp() {
  console.log(`${NAME} v${VERSION} - AI-powered terminal assistant

Usage:
  ${NAME}                      Start interactive mode
  ${NAME} "<message>"          Send a message and get a response
  ${NAME} [options]

Commands:
  init                       Set up Clarissa with your API key
  upgrade                    Upgrade to the latest version
  config                     View current configuration
  history                    Show one-shot query history

Options:
  -h, --help                 Show this help message
  -v, --version              Show version number
  -c, --continue             Continue the last session
  -m, --model <model>        Use a specific model for this request
  --list-models              List available models
  --check-update             Check for available updates
  --debug                    Enable debug output

Examples:
  ${NAME} init                 Set up your API key
  ${NAME} upgrade              Upgrade to latest version
  ${NAME} -c                   Continue last session
  ${NAME}                      Start interactive session
  ${NAME} "What is 2+2?"       Ask a quick question
  ${NAME} -m gpt-4o "Hello"    Use a specific model
  echo "Hello" | ${NAME}       Pipe input to ${NAME}

Interactive Commands:
  /help       Show available commands
  /new        Start a new conversation
  /last       Load the most recent session
  /model      Show or switch the current model
  /tools      List available tools
  /version    Show version info
  /upgrade    Upgrade to latest version
  /exit       Exit ${NAME}
`);
}

function listModels() {
  console.log("Available models:\n");
  for (const model of AVAILABLE_MODELS) {
    const current = model === agentConfig.model ? " (current)" : "";
    // Extract short name from model identifier (e.g., "anthropic/claude-sonnet-4" -> "claude-sonnet-4")
    const shortName = model.split("/").pop() || model;
    console.log(`  ${shortName.padEnd(28)} ${current}`);
  }
  console.log(`\nUse: ${NAME} -m <model> "<message>"`);
}

async function runOneShot(message: string, model?: string) {
  const debug = process.env.DEBUG === "true" || process.env.DEBUG === "1";

  if (model) {
    // Check if model is in available models list, or use as-is for custom models
    const resolvedModel = (AVAILABLE_MODELS as readonly string[]).includes(model) ? model : model;
    agentConfig.setModel(resolvedModel);
  }

  const agent = new Agent({
    onToolCall: (name, _args) => {
      if (debug) {
        console.error(`[Tool: ${name}]`);
      }
    },
    onToolResult: (name, result) => {
      if (debug) {
        console.error(`[Result: ${name}] ${result.slice(0, 100)}...`);
      }
    },
    onError: (error) => {
      console.error(`Error: ${error.message}`);
    },
  });

  try {
    const response = await agent.run(message);
    console.log(response);

    // Save to history
    await historyManager.add(message, response, agentConfig.model);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error(`Error: ${msg}`);
    process.exit(1);
  }
}

async function runConfig() {
  console.log(`Clarissa Configuration\n`);
  console.log(`Config file: ${CONFIG_FILE}`);
  console.log(`Config dir:  ${CONFIG_DIR}\n`);

  if (!existsSync(CONFIG_FILE)) {
    console.log("No config file found. Run 'clarissa init' to set up.");
    return;
  }

  try {
    const content = await Bun.file(CONFIG_FILE).json();
    console.log("Current settings:");
    console.log(`  Model:    ${content.model || "anthropic/claude-sonnet-4 (default)"}`);
    console.log(`  API Key:  ${content.apiKey ? "****" + content.apiKey.slice(-4) : "Not set"}`);

    if (content.mcpServers && Object.keys(content.mcpServers).length > 0) {
      console.log(`  MCP Servers:`);
      for (const [name, cfg] of Object.entries(content.mcpServers)) {
        const config = cfg as { command: string; args?: string[] };
        console.log(`    - ${name}: ${config.command} ${config.args?.join(" ") || ""}`);
      }
    }
  } catch (error) {
    console.error("Failed to read config file");
  }
}

async function runHistory() {
  const entries = await historyManager.getRecent(20);

  if (entries.length === 0) {
    console.log("No history yet. Run some one-shot queries first.");
    return;
  }

  console.log(`Recent Queries (${entries.length}):\n`);

  for (const entry of entries) {
    const date = new Date(entry.timestamp).toLocaleString();
    const query = entry.query.length > 60 ? entry.query.slice(0, 57) + "..." : entry.query;
    console.log(`  ${date}`);
    console.log(`  > ${query}`);
    console.log();
  }
}

async function runInit() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  console.log("Clarissa Setup\n");
  console.log("Get your API key from: https://openrouter.ai/keys\n");

  const apiKey = await prompt("Enter your OpenRouter API key: ");

  if (!apiKey.trim()) {
    console.error("Error: API key cannot be empty");
    rl.close();
    process.exit(1);
  }

  await initConfig(apiKey.trim());
  console.log(`\nConfig saved to ${CONFIG_FILE}`);
  console.log("Run 'clarissa' to start chatting!");

  rl.close();
}

async function main() {
  const args = process.argv.slice(2);

  // Parse flags
  let model: string | undefined;
  let continueSession = false;
  const positional: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    if (arg === "-v" || arg === "--version") {
      printVersion();
      process.exit(0);
    }

    if (arg === "--list-models") {
      listModels();
      process.exit(0);
    }

    if (arg === "--check-update") {
      await runCheckUpdate();
      process.exit(0);
    }

    if (arg === "init") {
      await runInit();
      process.exit(0);
    }

    if (arg === "upgrade") {
      await runUpgrade();
      process.exit(0);
    }

    if (arg === "config") {
      await runConfig();
      process.exit(0);
    }

    if (arg === "history") {
      await runHistory();
      process.exit(0);
    }

    if (arg === "-c" || arg === "--continue") {
      continueSession = true;
      continue;
    }

    if (arg === "--debug") {
      process.env.DEBUG = "true";
      continue;
    }

    if (arg === "-m" || arg === "--model") {
      model = args[++i];
      if (!model) {
        console.error("Error: --model requires a value");
        process.exit(1);
      }
      continue;
    }

    // Not a flag, treat as positional
    positional.push(arg);
  }

  // Check for piped input
  let pipedInput = "";
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    pipedInput = Buffer.concat(chunks).toString("utf-8").trim();
  }

  // Determine message from positional args or piped input
  const message = positional.length > 0 ? positional.join(" ") : pipedInput;

  // Check for updates (async, non-blocking)
  checkForUpdates();

  if (message) {
    // One-shot mode
    await runOneShot(message, model);
  } else {
    // Interactive mode
    console.clear();

    // Load last session if --continue flag is set
    if (continueSession) {
      const session = await sessionManager.getLatest();
      if (session) {
        render(<AppWithSession initialSession={session} />);
      } else {
        console.log("No previous session found. Starting fresh.\n");
        render(<AppWithErrorBoundary />);
      }
    } else {
      render(<AppWithErrorBoundary />);
    }
  }
}

main();

