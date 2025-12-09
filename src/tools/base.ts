import { z, type ZodType } from "zod";
import type { ToolDefinition } from "../llm/types.ts";

/**
 * Tool categories for organization
 */
export type ToolCategory = "file" | "git" | "system" | "mcp" | "utility";

/**
 * Tool priority levels - higher priority tools are included first for limited providers
 * Priority 1 = core tools always included
 * Priority 2 = important tools included when space allows
 * Priority 3 = extended tools only for capable providers
 */
export type ToolPriority = 1 | 2 | 3;

/**
 * Base interface for a tool that the agent can use
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  category?: ToolCategory;
  /** Priority for tool selection (1=core, 2=important, 3=extended). Default: 3 */
  priority?: ToolPriority;
  requiresConfirmation?: boolean;
  parameters: ZodType<TInput>;
  execute: (input: TInput) => Promise<TOutput>;
}

/**
 * Type alias for tools with any input/output for registry use
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = Tool<any, any>;

/**
 * Convert a Zod schema to JSON Schema for LLM tool definitions.
 * Uses Zod v4's native toJSONSchema function.
 */
function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema);

  // Remove $schema field as it's not needed for tool definitions
  // and remove additionalProperties to allow flexibility
  const { $schema, additionalProperties, ...rest } = jsonSchema as Record<string, unknown>;
  return rest;
}

/**
 * Convert a Tool to OpenRouter ToolDefinition format
 */
export function toolToDefinition(tool: Tool): ToolDefinition {
  const jsonSchema = zodToJsonSchema(tool.parameters);

  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: jsonSchema as ToolDefinition["function"]["parameters"],
    },
  };
}

/**
 * Helper to define a tool with proper typing
 */
export function defineTool<TInput, TOutput>(
  tool: Tool<TInput, TOutput>
): Tool<TInput, TOutput> {
  return tool;
}

