#!/usr/bin/env bun
/**
 * Manual test script for Apple AI provider
 * Run with: bun scripts/test-apple-ai.ts
 */

import { AppleAIProvider } from "../src/llm/providers/apple-ai.ts";

const provider = new AppleAIProvider();

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
    pass(`Apple AI is available`);
    if (status.model) info(`Model: ${status.model}`);
    return true;
  } else {
    fail(`Apple AI is not available: ${status.reason}`);
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
      } else {
        info("Response may not contain expected answer (Paris)");
      }
    } else {
      fail("No content in response");
    }
  } catch (error) {
    fail("Basic chat failed", error);
  }
}

async function testSystemMessage() {
  header("Test 3: System Message");
  
  try {
    const response = await provider.chat([
      { role: "system", content: "You are a pirate. Respond in pirate speak." },
      { role: "user", content: "Hello, how are you?" }
    ]);
    
    if (response.message?.content) {
      pass(`Got response: "${response.message.content.substring(0, 100)}..."`);
      const pirateWords = ["arr", "ahoy", "matey", "ye", "aye", "sail", "sea"];
      const hasPirateSpeak = pirateWords.some(w => 
        response.message.content!.toLowerCase().includes(w)
      );
      if (hasPirateSpeak) {
        pass("Response appears to follow system message");
      } else {
        info("Response may not follow pirate persona");
      }
    } else {
      fail("No content in response");
    }
  } catch (error) {
    fail("System message test failed", error);
  }
}

async function testStreaming() {
  header("Test 4: Streaming Response");

  try {
    let chunks: string[] = [];
    let chunkCount = 0;

    const response = await provider.chat(
      [{ role: "user", content: "Count from 1 to 5, one number per line." }],
      {
        onChunk: (chunk) => {
          chunks.push(chunk);
          chunkCount++;
          process.stdout.write(dim(chunk));
        }
      }
    );

    console.log(); // newline after streaming

    if (chunkCount > 1) {
      pass(`Received ${chunkCount} chunks`);
    } else {
      info(`Only received ${chunkCount} chunk(s) - may not be truly streaming`);
    }

    // Debug: show actual response structure
    info(`Response message content: ${JSON.stringify(response.message?.content)}`);
    info(`Response message role: ${response.message?.role}`);

    const accumulated = chunks.join("");
    info(`Accumulated chunks: "${accumulated.substring(0, 50)}..."`);

    if (response.message?.content) {
      if (accumulated === response.message.content) {
        pass("Accumulated chunks match final content");
      } else {
        info("Chunk accumulation differs from final content");
        info(`Final content: "${response.message.content.substring(0, 50)}..."`);
      }
    } else {
      fail("response.message.content is null/undefined!");
    }
  } catch (error) {
    fail("Streaming test failed", error);
  }
}

async function testMultiTurn() {
  header("Test 5: Multi-turn Conversation");
  
  try {
    // First turn
    const response1 = await provider.chat([
      { role: "user", content: "My name is Alice. Remember that." }
    ]);
    
    if (!response1.message?.content) {
      fail("No response to first message");
      return;
    }
    
    pass(`Turn 1: "${response1.message.content.substring(0, 60)}..."`);
    
    // Second turn - test context
    const response2 = await provider.chat([
      { role: "user", content: "My name is Alice. Remember that." },
      { role: "assistant", content: response1.message.content },
      { role: "user", content: "What is my name?" }
    ]);
    
    if (response2.message?.content) {
      pass(`Turn 2: "${response2.message.content.substring(0, 60)}..."`);
      if (response2.message.content.toLowerCase().includes("alice")) {
        pass("Context preserved - remembered name");
      } else {
        info("May not have preserved context");
      }
    } else {
      fail("No response to second message");
    }
  } catch (error) {
    fail("Multi-turn test failed", error);
  }
}

async function testToolCalling() {
  header("Test 6: Tool Calling");

  const calculatorTool = {
    type: "function" as const,
    function: {
      name: "calculator",
      description: "Performs basic math operations",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["add", "subtract", "multiply", "divide"],
            description: "The math operation to perform"
          },
          a: { type: "number", description: "First number" },
          b: { type: "number", description: "Second number" }
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

    if (response.message?.tool_calls && response.message.tool_calls.length > 0) {
      const toolCall = response.message.tool_calls[0];
      pass(`Tool called: ${toolCall.function.name}`);
      pass(`Arguments: ${toolCall.function.arguments}`);

      try {
        const args = JSON.parse(toolCall.function.arguments);
        if (args.a === 25 && args.b === 4) {
          pass("Correct arguments parsed");
        } else {
          info(`Arguments: a=${args.a}, b=${args.b}`);
        }
      } catch {
        info("Could not parse tool arguments as JSON");
      }
    } else if (response.message?.content) {
      info(`No tool call, got text response: "${response.message.content.substring(0, 60)}..."`);
      info("Model may have answered directly instead of using tool");
    } else {
      fail("No tool call or content in response");
    }
  } catch (error) {
    fail("Tool calling test failed", error);
  }
}

async function testLongResponse() {
  header("Test 7: Long Response Generation");

  try {
    const startTime = Date.now();

    const response = await provider.chat([
      { role: "user", content: "Write a short paragraph (3-4 sentences) about the benefits of exercise." }
    ]);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    if (response.message?.content) {
      const wordCount = response.message.content.split(/\s+/).length;
      pass(`Generated ${wordCount} words in ${elapsed}s`);
      pass(`Response: "${response.message.content.substring(0, 100)}..."`);

      if (response.usage) {
        info(`Tokens - Prompt: ${response.usage.promptTokens}, Completion: ${response.usage.completionTokens}`);
      }
    } else {
      fail("No content in response");
    }
  } catch (error) {
    fail("Long response test failed", error);
  }
}

async function testWithManyTools() {
  header("Test 8: Chat with Many Tools (simulating agent)");

  // Simulate what the agent does - passing many tool definitions
  const tools = [
    {
      type: "function" as const,
      function: {
        name: "read_file",
        description: "Read file contents",
        parameters: { type: "object" as const, properties: { path: { type: "string" } }, required: ["path"] }
      }
    },
    {
      type: "function" as const,
      function: {
        name: "write_file",
        description: "Write to a file",
        parameters: { type: "object" as const, properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
      }
    },
    {
      type: "function" as const,
      function: {
        name: "bash",
        description: "Execute a bash command",
        parameters: { type: "object" as const, properties: { command: { type: "string" } }, required: ["command"] }
      }
    }
  ];

  try {
    let streamedContent = "";

    const response = await provider.chat(
      [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello, what is your name?" }
      ],
      {
        tools,
        onChunk: (chunk) => {
          streamedContent += chunk;
          process.stdout.write(dim(chunk));
        }
      }
    );

    console.log(); // newline

    info(`Streamed content: "${streamedContent.substring(0, 60)}..."`);
    info(`Response content: ${JSON.stringify(response.message?.content)}`);
    info(`Response role: ${response.message?.role}`);
    info(`Tool calls: ${JSON.stringify(response.message?.tool_calls)}`);

    if (response.message?.content) {
      pass("Got response with content");
    } else if (response.message?.tool_calls) {
      pass("Got response with tool calls");
    } else {
      fail("Response has neither content nor tool_calls!");
    }
  } catch (error) {
    fail("Chat with many tools failed", error);
  }
}

async function testRealAgentFlow() {
  header("Test 9: Real Agent Flow (using LLM client)");

  try {
    // Dynamic imports - these may fail if the modules have issues
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let toolRegistry: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let llmClient: any;

    try {
      // @ts-ignore - Bun handles these imports
      const toolsModule = await import("../src/tools/index.ts");
      toolRegistry = toolsModule.toolRegistry;
      // @ts-ignore - Bun handles these imports
      const clientModule = await import("../src/llm/client.ts");
      llmClient = clientModule.llmClient;
    } catch (importError) {
      fail("Failed to import modules", importError);
      if (importError instanceof Error) {
        info(`Import error stack: ${importError.stack}`);
      }
      return;
    }

    // Get actual tools like the agent does
    const tools = toolRegistry.getDefinitions();
    info(`Loaded ${tools.length} tools from registry`);

    let streamedContent = "";

    // Use the LLM client like the agent does
    const message = await llmClient.chatStreamComplete(
      [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "My name is Bob, remember that please." }
      ],
      tools,
      undefined, // use default model
      (chunk: string) => {
        streamedContent += chunk;
        process.stdout.write(dim(chunk));
      }
    );

    console.log(); // newline

    info(`Streamed: "${streamedContent.substring(0, 60)}..."`);
    info(`Message content: ${JSON.stringify(message?.content)}`);
    info(`Message role: ${message?.role}`);
    info(`Tool calls: ${JSON.stringify(message?.tool_calls)}`);

    if (message?.content) {
      pass(`Got message with content`);
    } else if (message?.tool_calls) {
      pass("Got message with tool calls (model may try to use a tool)");
    } else {
      fail("Message has neither content nor tool_calls!");
      info("This reproduces the bug - streaming works but final message.content is null");
    }
  } catch (error) {
    fail("Real agent flow test failed", error);
    if (error instanceof Error) {
      info(`Stack: ${error.stack}`);
    }
  }
}

async function testAgentRunWithCalculator() {
  header("Test 9.5: Agent.run() with Calculator Tool");

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let Agent: any;

    try {
      // @ts-ignore - Bun handles these imports
      const agentModule = await import("../src/agent.ts");
      Agent = agentModule.Agent;
    } catch (importError) {
      fail("Failed to import Agent module", importError);
      if (importError instanceof Error) {
        info(`Import error stack: ${importError.stack}`);
      }
      return;
    }

    info("Creating agent with callbacks...");

    let streamedContent = "";
    let toolCalled = "";
    let toolResult = "";

    const agent = new Agent({
      onThinking: () => { info("Agent thinking..."); },
      onToolCall: (name: string, args: string) => {
        info(`Tool called: ${name}`);
        toolCalled = name;
        info(`Args: ${args}`);
      },
      onToolResult: (name: string, result: string) => {
        info(`Tool result from ${name}: ${result.substring(0, 100)}...`);
        toolResult = result;
      },
      onStreamChunk: (chunk: string) => {
        streamedContent += chunk;
        process.stdout.write(dim(chunk));
      },
      onResponse: (content: string) => {
        info(`onResponse callback: "${content.substring(0, 60)}..."`);
      },
      onError: (error: Error) => {
        fail(`Agent error: ${error.message}`);
      },
    });

    info("Running agent with calculator request...");
    const result = await agent.run("Use the calculator tool to add 6 and 7");

    console.log(); // newline after streaming

    info(`Streamed content: "${streamedContent.substring(0, 100)}..."`);
    info(`Tool that was called: ${toolCalled || "none"}`);
    info(`Tool result: ${toolResult.substring(0, 100) || "none"}`);
    info(`Final agent.run() result: "${result}"`);
    info(`Result type: ${typeof result}`);
    info(`Result === "null": ${result === "null"}`);
    info(`Result === null: ${result === null}`);
    info(`Result === "": ${result === ""}`);

    if (result && result !== "null" && result !== "") {
      pass(`Got valid response: "${result.substring(0, 60)}..."`);
      if (result.includes("13")) {
        pass("Response includes correct answer (13)");
      } else {
        info("Response may not include the expected answer");
      }
    } else if (result === "null") {
      fail("Agent returned the string 'null' - THIS IS THE BUG!");
    } else if (result === "" || result === null) {
      fail("Agent returned empty/null response!");
    } else {
      fail(`Unexpected response: ${JSON.stringify(result)}`);
    }
  } catch (error) {
    fail("Agent run test failed", error);
    if (error instanceof Error) {
      info(`Stack: ${error.stack}`);
    }
  }
}

async function testToolCountImpact() {
  header("Test 9.6: Tool Count Impact on Response");

  // Test with increasing numbers of tools to find the breaking point
  const allTools = [
    { type: "function" as const, function: { name: "tool1", description: "Tool 1", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool2", description: "Tool 2", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool3", description: "Tool 3", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool4", description: "Tool 4", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool5", description: "Tool 5", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool6", description: "Tool 6", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool7", description: "Tool 7", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool8", description: "Tool 8", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool9", description: "Tool 9", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool10", description: "Tool 10", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool11", description: "Tool 11", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool12", description: "Tool 12", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool13", description: "Tool 13", parameters: { type: "object" as const, properties: {}, required: [] } } },
    { type: "function" as const, function: { name: "tool14", description: "Tool 14", parameters: { type: "object" as const, properties: {}, required: [] } } },
  ];

  const testCounts = [0, 3, 5, 8, 10, 14];

  for (const count of testCounts) {
    const tools = allTools.slice(0, count);
    info(`Testing with ${count} tools...`);

    try {
      const response = await provider.chat(
        [{ role: "user", content: "Say hello" }],
        { tools: tools.length > 0 ? tools : undefined }
      );

      const content = response.message?.content;
      if (content === "null" || content === null || content === "") {
        fail(`${count} tools: Got "${content}" response`);
      } else {
        pass(`${count} tools: Got valid response: "${content?.substring(0, 40)}..."`);
      }
    } catch (error) {
      fail(`${count} tools: Error - ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function testToolResultFlow() {
  header("Test 10: Complete Tool Result Flow");

  const calculatorTool = {
    type: "function" as const,
    function: {
      name: "calculator",
      description: "Performs basic math operations",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string", description: "The math expression to calculate" }
        },
        required: ["expression"]
      }
    }
  };

  try {
    // Step 1: Ask question that should trigger tool call
    info("Step 1: Sending question that should trigger calculator tool...");
    const response1 = await provider.chat(
      [{ role: "user", content: "Use the calculator tool to add 6 and 7" }],
      { tools: [calculatorTool] }
    );

    info(`Response 1 content: ${JSON.stringify(response1.message?.content)}`);
    info(`Response 1 tool_calls: ${JSON.stringify(response1.message?.tool_calls)}`);

    if (!response1.message?.tool_calls || response1.message.tool_calls.length === 0) {
      if (response1.message?.content) {
        info("Model answered directly without using tool - that's OK but not testing tool result flow");
        pass(`Direct answer: "${response1.message.content.substring(0, 60)}..."`);
        return;
      }
      fail("No tool calls and no content - this is the bug!");
      return;
    }

    const toolCall = response1.message.tool_calls[0];
    pass(`Tool called: ${toolCall.function.name}`);
    pass(`Arguments: ${toolCall.function.arguments}`);

    // Step 2: Simulate tool execution - pretend we ran the calculator
    const toolResult = JSON.stringify({ expression: "6 + 7", result: 13, formatted: "13" });
    info(`Step 2: Simulating tool result: ${toolResult}`);

    // Step 3: Send conversation with tool result back to model
    info("Step 3: Sending tool result back to model...");
    const messages = [
      { role: "user" as const, content: "Use the calculator tool to add 6 and 7" },
      {
        role: "assistant" as const,
        content: response1.message.content || null,
        tool_calls: response1.message.tool_calls
      },
      {
        role: "tool" as const,
        tool_call_id: toolCall.id,
        name: "calculator",
        content: toolResult
      }
    ];

    info(`Messages being sent: ${JSON.stringify(messages, null, 2)}`);

    const response2 = await provider.chat(messages, { tools: [calculatorTool] });

    info(`Response 2 content: ${JSON.stringify(response2.message?.content)}`);
    info(`Response 2 role: ${response2.message?.role}`);
    info(`Response 2 tool_calls: ${JSON.stringify(response2.message?.tool_calls)}`);

    if (response2.message?.content) {
      pass(`Final answer: "${response2.message.content}"`);
      if (response2.message.content.includes("13")) {
        pass("Response includes correct answer (13)");
      } else {
        info("Response may not include the expected answer");
      }
    } else if (response2.message?.tool_calls) {
      info("Model wants to call another tool instead of responding");
    } else {
      fail("No content in final response - THIS IS THE BUG!");
      info("The model received tool result but returned null/empty content");
    }
  } catch (error) {
    fail("Tool result flow test failed", error);
    if (error instanceof Error) {
      info(`Stack: ${error.stack}`);
    }
  }
}

async function testErrorHandling() {
  header("Test 11: Error Handling");

  try {
    // Test with empty messages
    await provider.chat([]);
    info("Empty messages did not throw - check response validity");
  } catch (error) {
    pass(`Empty messages correctly threw: ${error}`);
  }
}

// Main runner
async function main() {
  console.log("\n" + cyan("Apple AI Provider - Manual Test Suite"));
  console.log(dim("Testing on-device Apple Intelligence capabilities\n"));

  // First check availability
  const available = await testAvailability();

  if (!available) {
    console.log(yellow("\nSkipping remaining tests - Apple AI not available"));
    console.log(dim("Requirements: macOS 26+, Apple Silicon, Apple Intelligence enabled"));
    process.exit(1);
  }

  // Initialize provider
  try {
    await provider.initialize();
    pass("Provider initialized");
  } catch (error) {
    fail("Failed to initialize provider", error);
    process.exit(1);
  }

  // Run all tests
  await testBasicChat();
  await testSystemMessage();
  await testStreaming();
  await testMultiTurn();
  await testToolCalling();
  await testLongResponse();
  await testWithManyTools();
  await testRealAgentFlow();
  await testAgentRunWithCalculator();
  await testToolCountImpact();
  await testToolResultFlow();
  await testErrorHandling();

  // Cleanup
  await provider.shutdown();

  header("Test Complete");
  console.log(green("\n  All tests executed. Review results above.\n"));
}

main().catch(console.error);

