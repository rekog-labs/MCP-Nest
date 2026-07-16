import { CanActivate, SetMetadata, Type } from '@nestjs/common';
import { z } from 'zod';
import { ToolAnnotations as SdkToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { MCP_TOOL_METADATA_KEY } from './constants';
import type { HttpRequest } from '../interfaces/http-adapter.interface';

/**
 * Security scheme type for MCP tools
 */
export type SecurityScheme =
  | { type: 'noauth' }
  | { type: 'oauth2'; scopes?: string[] };

/**
 * Per-request context handed to a {@link ToolSchemaResolver}. It carries the
 * adapted HTTP request and the authenticated user (when present) so a tool's
 * input schema can depend on the caller's identity.
 */
export interface ToolSchemaContext {
  /** The adapted HTTP request for this MCP call (undefined for STDIO). */
  httpRequest: HttpRequest;
  /** The authenticated user attached to `httpRequest.raw`, if any. */
  user?: unknown;
}

/**
 * A function form of a tool's `parameters` that resolves the Zod input schema
 * from the caller's identity. It is invoked at BOTH `tools/list` rendering and
 * `tools/call` validation with the same context, so the advertised schema and
 * the validation schema can never disagree. Plain `z.ZodType` values are used
 * as-is, so tools that do not opt in are unaffected.
 */
export type ToolSchemaResolver = (ctx: ToolSchemaContext) => z.ZodType;

export interface ToolMetadata {
  name: string;
  description: string;
  parameters?: z.ZodType | ToolSchemaResolver;
  outputSchema?: z.ZodType;
  annotations?: SdkToolAnnotations;
  _meta?: Record<string, any>;
  // Security-related metadata
  securitySchemes?: SecurityScheme[];
  isPublic?: boolean;
  requiredScopes?: string[];
  requiredRoles?: string[];
  guards?: Type<CanActivate>[];
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ToolAnnotations extends SdkToolAnnotations {}

export interface ToolOptions {
  name?: string;
  description?: string;
  parameters?: z.ZodType | ToolSchemaResolver;
  outputSchema?: z.ZodType;
  annotations?: ToolAnnotations;
  _meta?: Record<string, any>;
}

/**
 * Decorator that marks a controller method as an MCP tool.
 * @param {Object} options - The options for the decorator
 * @param {string} options.name - The name of the tool
 * @param {string} options.description - The description of the tool
 * @param {z.ZodType | ToolSchemaResolver} [options.parameters] - The parameters of the tool.
 *   May be a Zod schema, or a `(ctx) => z.ZodType` resolver evaluated per identity.
 * @param {z.ZodType} [options.outputSchema] - The output schema of the tool
 * @returns {MethodDecorator} - The decorator
 */
export const Tool = (options: ToolOptions) => {
  if (options.parameters === undefined) {
    options.parameters = z.object({});
  }

  return SetMetadata(MCP_TOOL_METADATA_KEY, options);
};
