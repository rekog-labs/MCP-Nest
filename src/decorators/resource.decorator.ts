import { SetMetadata } from '@nestjs/common';
import { MCP_RESOURCE_METADATA_KEY } from './constants';

export type ResourceOptions =
  // https://modelcontextprotocol.io/docs/concepts/resources#direct-resources
  | {
      uri: string; // Unique identifier for the resource
      name: string; // Human-readable name
      description?: string; // Optional description
      mimeType?: string; // Optional MIME type
    }
  //https://modelcontextprotocol.io/docs/concepts/resources#resource-templates
  | {
      uriTemplate: string; // URI template following RFC 6570
      name: string; // Human-readable name for this type
      description?: string; // Optional description
      mimeType?: string; // Optional MIME type for all matching resources
    };

export type ResourceMetadata = ResourceOptions;

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
