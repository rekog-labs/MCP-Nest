import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { McpHandlerBase } from '../services/handlers/mcp-handler.base';

export type Literal = boolean | null | number | string | undefined;

export type SerializableValue =
  | Literal
  | SerializableValue[]
  | { [key: string]: SerializableValue };

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
  mcpServer: Parameters<McpHandlerBase['createContext']>[0];
  mcpRequest: Parameters<McpHandlerBase['createContext']>[1];
};
