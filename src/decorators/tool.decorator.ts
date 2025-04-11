import { SetMetadata } from '@nestjs/common';
import { MCP_TOOL_METADATA_KEY } from './constants';
import { z } from 'zod';

export interface ToolMetadata {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny;
}

export interface ToolOptions {
  name: string;
  description: string;
  parameters?: z.ZodTypeAny;
}

/**
 * Decorator that marks a controller method as an MCP tool.
 * @param {Object} options - The options for the decorator
 * @param {string} options.name - The name of the tool
 * @param {string} options.description - The description of the tool
 * @param {z.ZodTypeAny} [options.parameters] - The parameters of the tool
 * @returns {MethodDecorator} - The decorator
 */
export const Tool = (options: ToolOptions) => {
  if (options.parameters === undefined) {
    options.parameters = z.object({});
  }
  return SetMetadata(MCP_TOOL_METADATA_KEY, options);
};
