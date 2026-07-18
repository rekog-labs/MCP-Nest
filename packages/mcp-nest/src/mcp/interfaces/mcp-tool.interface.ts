import { Progress, McpServer } from "@modelcontextprotocol/server";
import { CallToolRequestSchema, GetPromptRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/core";
import { z } from 'zod';
export type Literal = boolean | null | number | string | undefined;

export type SerializableValue =
  | Literal
  | SerializableValue[]
  | { [key: string]: SerializableValue };

export type McpRequestSchema =
  | typeof CallToolRequestSchema
  | typeof ReadResourceRequestSchema
  | typeof GetPromptRequestSchema;

export type McpRequest = z.infer<McpRequestSchema>;

/**
 * Enhanced execution context that includes user information
 */
export type Context = {
  reportProgress: (progress: Progress) => Promise<void>;
  log: {
    debug: (message: string, data?: SerializableValue) => void;
    error: (message: string, data?: SerializableValue) => void;
    info: (message: string, data?: SerializableValue) => void;
    warn: (message: string, data?: SerializableValue) => void;
  };
  mcpServer: McpServer;
  mcpRequest: McpRequest;
};
