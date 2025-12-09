#!/usr/bin/env bun
/**
 * Manual test script for OpenRouter provider
 * Run with: bun scripts/test-openrouter.ts
 *
 * Requires OPENROUTER_API_KEY in .env file
 */

import { OpenRouterProvider } from "../src/llm/providers/openrouter.ts";

const apiKey = process.env.OPENROUTER_API_KEY;

if (!apiKey) {
  console.error("\x1b[31mError: OPENROUTER_API_KEY not set in .env file\x1b[0m");
  console.log("\x1b[2mCreate a .env file with your OpenRouter API key:\x1b[0m");
  console.log("  OPENROUTER_API_KEY=your-key-here");
  process.exit(1);
}

const provider = new OpenRouterProvider(apiKey);

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

async function testAvailability(): Promise<boolean> {
  header("Test 1: Availability Check");

  const status = await provider.checkAvailability();

  if (status.available) {
    pass(`OpenRouter is available`);
    if (status.model) info(`Model: ${status.model}`);
    return true;
  } else {
    fail(`OpenRouter is not available: ${status.reason}`);
    return false;
  }
}

async function testBasicChat() {
  header("Test 2: Basic Chat Completion");

  try {
    const response = await provider.chat([
      { role: "user", content: "What is 2 + 2? Reply with just the number." }
    ]);

    if (response.message?.content) {
      pass(`Got response: "${response.message.content.trim()}"`);
      if (response.message.content.includes("4")) {
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
  header("Test 3: Streaming Response");

  try {
    let chunks: string[] = [];
    let chunkCount = 0;

    const response = await provider.chat(
      [{ role: "user", content: "Count from 1 to 3, one number per line." }],
      {
        onChunk: (chunk) => {
          chunks.push(chunk);
          chunkCount++;
          process.stdout.write(dim(chunk));
        }
      }
    );

    console.log();

    if (chunkCount > 1) {
      pass(`Received ${chunkCount} chunks`);
    } else {
      info(`Only received ${chunkCount} chunk(s)`);
    }

    if (response.message?.content) {
      pass(`Final content: "${response.message.content.substring(0, 60)}..."`);
    }
  } catch (error) {
    fail("Streaming test failed", error);
  }
}

async function testToolCalling() {
  header("Test 4: Tool Calling");

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
          b: { type: "number" }
        },
        required: ["operation", "a", "b"]
      }
    }
  };

  try {
    const response = await provider.chat(
      [{ role: "user", content: "What is 15 multiplied by 3? Use the calculator tool." }],
      { tools: [calculatorTool] }
    );

    if (response.message?.tool_calls && response.message.tool_calls.length > 0) {
      const toolCall = response.message.tool_calls[0];
      pass(`Tool called: ${toolCall.function.name}`);
      pass(`Arguments: ${toolCall.function.arguments}`);
    } else if (response.message?.content) {
      info(`No tool call, got text: "${response.message.content.substring(0, 60)}..."`);
    } else {
      fail("No tool call or content in response");
    }
  } catch (error) {
    fail("Tool calling test failed", error);
  }
}

async function main() {
  console.log("\n" + cyan("OpenRouter Provider - Manual Test Suite"));
  console.log(dim("Testing cloud LLM via OpenRouter API\n"));

  const available = await testAvailability();
  if (!available) process.exit(1);

  await provider.initialize();
  pass("Provider initialized");

  await testBasicChat();
  await testStreaming();
  await testToolCalling();

  header("Tests Complete");
  console.log(green("\n  All tests executed. Review results above.\n"));
}

main().catch(console.error);

