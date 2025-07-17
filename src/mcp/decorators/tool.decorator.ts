import { SetMetadata } from '@nestjs/common';
import { MCP_TOOL_METADATA_KEY } from './constants';
import { z } from 'zod';

export interface ToolMetadata {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
  annotations?: ToolAnnotations;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolOptions {
  name?: string;
  description?: string;
  parameters?: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny;
  annotations?: ToolAnnotations;
}

/**
 * Decorator that marks a controller method as an MCP tool.
 * @param {Object} options - The options for the decorator
 * @param {string} options.name - The name of the tool
 * @param {string} options.description - The description of the tool
 * @param {z.ZodTypeAny} [options.parameters] - The parameters of the tool
 * @param {z.ZodTypeAny} [options.outputSchema] - The output schema of the tool
 * @returns {MethodDecorator} - The decorator
 */
export const Tool = (options: ToolOptions) => {
  if (options.parameters === undefined) {
    options.parameters = z.object({});
  }

  return SetMetadata(MCP_TOOL_METADATA_KEY, options);
};
