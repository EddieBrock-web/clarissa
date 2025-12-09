#!/usr/bin/env bun
/**
 * Manual test script for Anthropic provider
 * Run with: bun scripts/test-anthropic.ts
 * Requires ANTHROPIC_API_KEY in .env
 */

import { AnthropicProvider } from "../src/llm/providers/anthropic.ts";

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

// Get API key from environment
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.log(red("\nError: ANTHROPIC_API_KEY not found in .env"));
  console.log(dim("Add ANTHROPIC_API_KEY=your-key to .env file"));
  process.exit(1);
}

const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514";
const provider = new AnthropicProvider(apiKey, model);

async function testAvailability(): Promise<boolean> {
  header("Test 1: Availability Check");
  const status = await provider.checkAvailability();
  if (status.available) {
    pass(`Anthropic is available`);
    if (status.model) info(`Model: ${status.model}`);
    return true;
  } else {
    fail(`Anthropic is not available: ${status.reason}`);
    return false;
  }
}

async function testBasicChat() {
  header("Test 2: Basic Chat Completion");
  try {
    const response = await provider.chat([
      { role: "user", content: "What is the capital of France? Reply in one word." }
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
  header("Test 3: Streaming Response");
  try {
    let chunks: string[] = [];
    const response = await provider.chat(
      [{ role: "user", content: "Count from 1 to 5, one number per line." }],
      {
        onChunk: (chunk) => {
          chunks.push(chunk);
          process.stdout.write(dim(chunk));
        }
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
  header("Test 4: Tool Calling");
  const calculatorTool = {
    type: "function" as const,
    function: {
      name: "calculator",
      description: "Performs basic math operations",
      parameters: {
        type: "object" as const,
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
      [{ role: "user", content: "What is 25 multiplied by 4? Use the calculator tool." }],
      { tools: [calculatorTool] }
    );
    if (response.message?.tool_calls?.length) {
      const toolCall = response.message.tool_calls[0]!;
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
  console.log("\n" + cyan("Anthropic Provider - Manual Test Suite"));
  console.log(dim(`Using model: ${model}\n`));

  const available = await testAvailability();
  if (!available) process.exit(1);

  await provider.initialize();
  await testBasicChat();
  await testStreaming();
  await testToolCalling();

  header("Test Complete");
  console.log(green("\n  All tests executed. Review results above.\n"));
}

main().catch(console.error);

