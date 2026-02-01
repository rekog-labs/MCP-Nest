import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  Progress,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ElicitRequestURLParams, ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ElicitationResult } from '../../elicitation/interfaces/elicitation.interface';

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
 * Parameters for creating a URL elicitation.
 */
export interface CreateUrlElicitationParams {
  /** Message explaining why the elicitation is needed */
  message: string;

  /**
   * Endpoint path to use for the elicitation URL.
   * Built-in paths: 'api-key', 'confirm'
   * Or provide a custom path for your own endpoints.
   */
  path?: string;

  /**
   * Metadata to store with the elicitation.
   * Include 'type' for lookup via findByUserAndType.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Result of creating a URL elicitation.
 */
export interface CreateUrlElicitationResult {
  /** The unique elicitation ID */
  elicitationId: string;

  /** The URL the user should open */
  url: string;

  /** Callback to send completion notification to the client */
  completionNotifier: () => Promise<void>;
}

/**
 * Elicitation helpers available on the Context when McpElicitationModule is configured.
 */
export interface ElicitationContext {
  /**
   * Create a new URL elicitation.
   *
   * @param params - Elicitation parameters
   * @returns The elicitation ID, URL, and completion notifier
   *
   * @example
   * ```typescript
   * const { elicitationId, url, completionNotifier } = await context.elicitation.createUrl({
   *   message: 'Please enter your API key',
   *   path: 'api-key',
   *   metadata: { type: 'api-key-stripe', userId },
   * });
   * ```
   */
  createUrl(params: CreateUrlElicitationParams): Promise<CreateUrlElicitationResult>;

  /**
   * Throw a UrlElicitationRequiredError to signal the client that a URL elicitation is needed.
   * The client will display the URL(s) to the user and can retry the tool call after completion.
   *
   * @param elicitations - Array of elicitation requests
   * @throws UrlElicitationRequiredError
   *
   * @example
   * ```typescript
   * context.elicitation.throwRequired([{
   *   mode: 'url',
   *   message: 'Please enter your API key',
   *   url,
   *   elicitationId,
   * }]);
   * ```
   */
  throwRequired(elicitations: ElicitRequestURLParams[]): never;

  /**
   * Check if the client supports URL elicitation.
   *
   * @returns True if URL elicitation is supported
   */
  isSupported(): boolean;

  /**
   * Get a completed elicitation result by elicitation ID.
   *
   * @param elicitationId - The elicitation ID
   * @returns The result if found and completed, undefined otherwise
   */
  getResult(elicitationId: string): Promise<ElicitationResult | undefined>;

  /**
   * Find a completed elicitation result by user ID and type.
   * Type is stored in the elicitation's metadata.type field.
   *
   * @param userId - The user identifier
   * @param type - The elicitation type (from metadata.type)
   * @returns The most recent matching result, or undefined
   *
   * @example
   * ```typescript
   * const result = await context.elicitation.findByUserAndType(userId, 'api-key-stripe');
   * if (result?.success && result.data?.apiKey) {
   *   // Use the stored API key
   * }
   * ```
   */
  findByUserAndType(userId: string, type: string): Promise<ElicitationResult | undefined>;

  /**
   * Send a form-mode elicitation request to the client.
   * This is a convenience wrapper around mcpServer.server.elicitInput() for form mode.
   *
   * @param params - Form elicitation parameters
   * @returns The elicitation result
   */
  elicitForm(params: {
    message: string;
    requestedSchema: object;
  }): Promise<ElicitResult>;
}

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

  /**
   * Elicitation helpers (available when McpElicitationModule is configured).
   * Use this to request sensitive user input through URL-based flows.
   */
  elicitation?: ElicitationContext;
};
