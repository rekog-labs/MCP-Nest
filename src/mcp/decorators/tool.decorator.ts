import { SetMetadata } from '@nestjs/common';
import { MCP_TOOL_METADATA_KEY } from './constants';
import { ToolAnnotations as SdkToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

export interface ToolMetadata {
  name: string;
  description: string;
  parameters?: any;
  outputSchema?: any;
  annotations?: SdkToolAnnotations;
  _meta?: Record<string, any>;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ToolAnnotations extends SdkToolAnnotations {}

export interface ToolOptions {
  name?: string;
  description?: string;
  parameters?: any;
  outputSchema?: any;
  annotations?: ToolAnnotations;
  _meta?: Record<string, any>;
}

/**
 * Decorator that marks a controller method as an MCP tool.
 * @param {Object} options - The options for the decorator
 * @param {string} options.name - The name of the tool
 * @param {string} options.description - The description of the tool
 * @param {any} [options.parameters] - The parameters of the tool (Zod schema or class-validator class)
 * @param {any} [options.outputSchema] - The output schema of the tool (Zod schema or class-validator class)
 * @returns {MethodDecorator} - The decorator
 */
export const Tool = (options: ToolOptions) => {
  return SetMetadata(MCP_TOOL_METADATA_KEY, options);
};
