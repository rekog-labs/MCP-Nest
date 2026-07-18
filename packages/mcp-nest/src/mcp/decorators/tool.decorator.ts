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

export interface ToolMetadata {
  name: string;
  description: string;
  parameters?: ToolInputSchema;
  outputSchema?: ToolInputSchema;
  annotations?: SdkToolAnnotations;
  _meta?: Record<string, any>;
  // Security-related metadata
  securitySchemes?: SecurityScheme[];
  isPublic?: boolean;
  requiredScopes?: string[];
  requiredRoles?: string[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ToolAnnotations extends SdkToolAnnotations {}

export interface ToolOptions {
  name?: string;
  description?: string;
  parameters?: ToolInputSchema;
  outputSchema?: ToolInputSchema;
  annotations?: ToolAnnotations;
  _meta?: Record<string, any>;
}

/**
 * Decorator that marks a controller method as an MCP tool.
 * @param {Object} options - The options for the decorator
 * @param {string} options.name - The name of the tool
 * @param {string} options.description - The description of the tool
 * @param {z.ZodType} [options.parameters] - The parameters of the tool
 * @param {z.ZodType} [options.outputSchema] - The output schema of the tool
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
