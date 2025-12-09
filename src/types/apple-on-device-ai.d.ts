/**
 * Type declarations for @meridius-labs/apple-on-device-ai
 * This module is macOS-only and may not be installed on other platforms.
 */
declare module "@meridius-labs/apple-on-device-ai" {
  export interface AppleAIChatMessage {
    role: "user" | "assistant" | "system";
    content: string;
  }

  export interface AppleAITool {
    name: string;
    description: string;
    jsonSchema: unknown;
    handler?: (args: unknown) => Promise<unknown>;
  }

  export interface AppleAIChatOptions {
    messages: string | AppleAIChatMessage[];
    schema?: unknown;
    tools?: AppleAITool[];
    stream?: boolean;
    temperature?: number;
    maxTokens?: number;
  }

  export interface AppleAIToolCall {
    id?: string;
    function: {
      name: string;
      arguments: string;
    };
  }

  export interface AppleAIChatResponse {
    text: string;
    object?: unknown;
    toolCalls?: AppleAIToolCall[];
  }

  export function chat(
    options: AppleAIChatOptions
  ): Promise<AppleAIChatResponse> | AsyncIterable<string>;

  export const appleAISDK: {
    checkAvailability: () => Promise<boolean>;
    getSupportedLanguages: () => Promise<string[]>;
  };
}

