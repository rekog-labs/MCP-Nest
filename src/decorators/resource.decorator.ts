import { SetMetadata } from '@nestjs/common';
import { MCP_RESOURCE_METADATA_KEY } from './constants';

export interface ResourceMetadata {
  name: string;
  uri: string;
}

export interface ResourceOptions {
  name: string;
  uri: string;
}

/**
 * Decorator that marks a controller method as an MCP resource.
 * @param {Object} options - The options for the decorator
 * @param {string} options.name - The name of the resource
 * @param {string} options.uri - The URI of the resource
 * @returns {MethodDecorator} - The decorator
 */
export const Resource = (options: ResourceOptions) => {
  return SetMetadata(MCP_RESOURCE_METADATA_KEY, options);
};
