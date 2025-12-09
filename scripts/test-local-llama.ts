#!/usr/bin/env bun
/**
 * Manual test script for Local Llama (node-llama-cpp) provider
 * Run with: bun scripts/test-local-llama.ts
 *
 * Downloads a model if not already present. Set LOCAL_LLAMA_MODEL to override:
 *   - qwen2.5-7b-f16 (default, 15.2GB, full precision best for tool use)
 *   - qwen2.5-7b (4.7GB, quantized good balance)
 */

import { LocalLlamaProvider } from "../src/llm/providers/local-llama.ts";
import {
  RECOMMENDED_MODELS,
  downloadModel,
  getModelPath,
  isModelDownloaded,
  formatBytes,
  formatSpeed,
} from "../src/models/download.ts";

// Colors for output
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

function header(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(cyan(`  ${title}`));
  console.log("=".repeat(60));
}

function pass(msg: string) {
  console.log(green("  PASS") + ` ${msg}`);
}

function fail(msg: string, error?: unknown) {
  console.log(red("  FAIL") + ` ${msg}`);
  if (error) console.log(dim(`       ${error}`));
}

function info(msg: string) {
  console.log(yellow("  INFO") + ` ${msg}`);
}

// Get model from environment or default to qwen2.5-7b-f16 (full precision, best tool use)
const modelId = process.env.LOCAL_LLAMA_MODEL || "qwen2.5-7b-f16";
const modelInfo = RECOMMENDED_MODELS.find((m) => m.id === modelId);

if (!modelInfo) {
  console.log(red(`\nError: Unknown model "${modelId}"`));
  console.log(dim("Available models:"));
  for (const m of RECOMMENDED_MODELS) {
    console.log(dim(`  - ${m.id}: ${m.name} (${m.size})`));
  }
  process.exit(1);
}

let provider: LocalLlamaProvider;

async function downloadModelIfNeeded(): Promise<string> {
  header("Step 0: Model Download");

  const exists = await isModelDownloaded(modelInfo!.file);
  if (exists) {
    const modelPath = getModelPath(modelInfo!.file);
    pass(`Model already downloaded: ${modelInfo!.file}`);
    return modelPath;
  }

  info(`Downloading ${modelInfo!.name} (${modelInfo!.size})...`);
  info(`From: ${modelInfo!.repo}`);

  try {
    const modelPath = await downloadModel(modelInfo!.repo, modelInfo!.file, (progress) => {
      const percent = progress.percent.toFixed(1);
      const downloaded = formatBytes(progress.downloaded);
      const total = formatBytes(progress.total);
      const speed = formatSpeed(progress.speed);
      process.stdout.write(`\r  ${cyan("DOWNLOADING")} ${percent}% (${downloaded}/${total}) at ${speed}    `);
    });
    console.log();
    pass(`Download complete: ${modelPath}`);
    return modelPath;
  } catch (error) {
    console.log();
    fail("Download failed", error);
    process.exit(1);
  }
}

async function testAvailability(): Promise<boolean> {
  header("Test 1: Availability Check");
  const status = await provider.checkAvailability();
  if (status.available) {
    pass("Local Llama is available");
    if (status.model) info(`Model: ${status.model}`);
    if (status.metadata) {
      info(`File size: ${status.metadata.fileSizeMB} MB`);
      info(`Estimated memory: ${status.metadata.estimatedMemoryMB} MB`);
    }
    return true;
  } else {
    fail(`Local Llama is not available: ${status.reason}`);
    return false;
  }
}

async function testInitialization() {
  header("Test 2: Model Loading");
  try {
    info("Loading model (this may take a moment)...");
    await provider.initialize((progress) => {
      const percent = (progress * 100).toFixed(1);
      process.stdout.write(`\r  ${cyan("LOADING")} ${percent}%    `);
    });
    console.log();
    pass("Model loaded successfully");
  } catch (error) {
    console.log();
    fail("Model loading failed", error);
    throw error;
  }
}

async function testBasicChat() {
  header("Test 3: Basic Chat Completion");
  try {
    const response = await provider.chat([
      { role: "user", content: "What is the capital of France? Reply in one word." },
    ]);
    if (response.message?.content) {
      pass(`Got response: "${response.message.content.trim()}"`);
      if (response.message.content.toLowerCase().includes("paris")) {
        pass("Response contains expected answer");
      }
    } else {
      fail("No content in response");
    }
  } catch (error) {
    fail("Basic chat failed", error);
  }
}

async function testStreaming() {
  header("Test 4: Streaming Response");
  try {
    const chunks: string[] = [];
    const response = await provider.chat(
      [{ role: "user", content: "Count from 1 to 5, one number per line." }],
      {
        onChunk: (chunk) => {
          chunks.push(chunk);
          process.stdout.write(dim(chunk));
        },
      }
    );
    console.log();
    if (chunks.length > 1) {
      pass(`Received ${chunks.length} chunks`);
    } else {
      info(`Only received ${chunks.length} chunk(s)`);
    }
    if (response.message?.content) {
      pass("Final content received");
    }
  } catch (error) {
    fail("Streaming test failed", error);
  }
}

async function testToolCalling() {
  header("Test 5: Tool Calling");
  const calculatorTool = {
    type: "function" as const,
    function: {
      name: "calculator",
      description: "Performs basic math operations",
      parameters: {
        type: "object",
        properties: {
          operation: { type: "string", enum: ["add", "subtract", "multiply", "divide"] },
          a: { type: "number" },
          b: { type: "number" },
        },
        required: ["operation", "a", "b"],
      },
    },
  };

  try {
    const response = await provider.chat(
      [{ role: "user", content: "What is 25 multiplied by 4? Use the calculator tool." }],
      { tools: [calculatorTool] }
    );
    if (response.message?.tool_calls?.length) {
      const toolCall = response.message.tool_calls[0];
      pass(`Tool called: ${toolCall.function.name}`);
      pass(`Arguments: ${toolCall.function.arguments}`);
    } else if (response.message?.content) {
      info(`No tool call, got text: "${response.message.content.substring(0, 60)}..."`);
    } else {
      fail("No tool call or content");
    }
  } catch (error) {
    fail("Tool calling test failed", error);
  }
}

async function main() {
  console.log("\n" + cyan("Local Llama Provider - Manual Test Suite"));
  console.log(dim(`Using model: ${modelInfo!.name} (${modelInfo!.id})`));
  console.log(dim(`${modelInfo!.description}\n`));

  // Download model if needed
  const modelPath = await downloadModelIfNeeded();

  // Create provider with downloaded model
  provider = new LocalLlamaProvider({
    modelPath,
    gpuLayers: -1, // Auto GPU offload
    contextSize: 4096,
    flashAttention: true,
  });

  const available = await testAvailability();
  if (!available) process.exit(1);

  await testInitialization();
  await testBasicChat();
  await testStreaming();
  await testToolCalling();

  // Cleanup
  header("Cleanup");
  await provider.shutdown();
  pass("Provider shutdown complete");

  header("Test Complete");
  console.log(green("\n  All tests executed. Review results above.\n"));
}

main().catch(console.error);

