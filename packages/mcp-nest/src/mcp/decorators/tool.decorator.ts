import { applyDecorators, SetMetadata } from '@nestjs/common';
import { z } from 'zod';
import {
  ToolAnnotations as SdkToolAnnotations,
  type StandardSchemaV1,
} from '@modelcontextprotocol/server';
import { MCP_TOOL_METADATA_KEY } from './constants';
import { mcpMessagePattern } from './mcp-message-pattern';

/**
 * Schema accepted by a `@Tool`'s `parameters` / `outputSchema`.
 *
 * Zod remains the default and its emitted JSON Schema is unchanged, but any
 * Standard Schema validator that also carries a JSON Schema (e.g. Zod 4.2+,
 * ArkType 2.1+, or Valibot wrapped with `@valibot/to-json-schema`'s
 * `toStandardJsonSchema`) is now accepted, as is a raw JSON Schema object.
 */
export type ToolInputSchema =
  | z.ZodType
  | StandardSchemaV1
  | Record<string, unknown>;

/**
 * Security scheme type for MCP tools
 */
export type SecurityScheme =
  | { type: 'noauth' }
  | { type: 'oauth2'; scopes?: string[] };

/**
 * How a list of required scopes/roles is matched against what the caller
 * holds: `'all'` (AND, the caller needs to hold all roles) or `'any'` (OR —
 * the caller only needs to hold one of them).
 */
export type AccessMatchMode = 'all' | 'any';

export interface ToolMetadata {
  name: string;
  title?: string;
  description: string;
  parameters?: ToolInputSchema;
  outputSchema?: ToolInputSchema;
  /** Skip the server's own `outputSchema` check; see `ToolOptions`. */
  disableResponseValidation?: boolean;
  annotations?: SdkToolAnnotations;
  _meta?: Record<string, any>;
  // Security-related metadata
  securitySchemes?: SecurityScheme[];
  isPublic?: boolean;
  requiredScopes?: string[];
  requiredScopesMatch?: AccessMatchMode;
  requiredRoles?: string[];
  requiredRolesMatch?: AccessMatchMode;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ToolAnnotations extends SdkToolAnnotations {}

export interface ToolOptions {
  name?: string;
  title?: string;
  description?: string;
  parameters?: ToolInputSchema;
  outputSchema?: ToolInputSchema;
  /**
   * Skip the server's own check of the result against `outputSchema`; the
   * schema is still advertised. The raw handler result is sent as
   * `structuredContent` (no Zod defaults, transforms or unknown-key
   * stripping), so it must already conform: spec-compliant clients, including
   * the MCP SDK client, validate it and reject non-conforming output.
   * Overrides `McpServerOptions.disableResponseValidation` for this tool.
   */
  disableResponseValidation?: boolean;
  annotations?: ToolAnnotations;
  _meta?: Record<string, any>;
}

/**
 * Decorator that marks a controller method as an MCP tool.
 * @param {Object} options - The options for the decorator
 * @param {string} options.name - The name of the tool
 * @param {string} [options.title] - Human-readable display name of the tool
 * @param {string} options.description - The description of the tool
 * @param {z.ZodType} [options.parameters] - The parameters of the tool
 * @param {z.ZodType} [options.outputSchema] - The output schema of the tool
 * @param {boolean} [options.disableResponseValidation] - Skip the server's check of the result against `outputSchema`
 * @returns {MethodDecorator} - The decorator
 */
export const Tool = (options: ToolOptions) => {
  if (options.parameters === undefined) {
    options.parameters = z.object({});
  }

  return applyDecorators(
    SetMetadata(MCP_TOOL_METADATA_KEY, options),
    mcpMessagePattern('tool', options.name),
  );
};
