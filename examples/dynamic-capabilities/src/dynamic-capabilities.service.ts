import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { MCP_STRATEGY, McpStrategy } from '@rekog/mcp-nest';
import { z } from 'zod';

const collections = [{ name: 'products' }, { name: 'docs' }];

@Injectable()
export class DynamicCapabilitiesService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    // Basic registration
    this.strategy.registerTool({
      name: 'search-knowledge',
      description: 'Search the knowledge base',
      parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().default(10),
      }),
      handler: async (args) => {
        return {
          content: [{ type: 'text', text: `Results for: ${args.query}` }],
        };
      },
    });

    // Loading from database
    const collectionNames = collections.map((c) => c.name).join(', ');
    this.strategy.registerTool({
      name: 'search-collection',
      description: `Search across collections. Available: ${collectionNames}`,
      parameters: z.object({
        query: z.string(),
        collection: z.enum(
          collections.map((c) => c.name) as [string, ...string[]],
        ),
      }),
      handler: async (args) => {
        const results = { query: args.query, collection: args.collection };
        return {
          content: [{ type: 'text', text: JSON.stringify(results) }],
        };
      },
    });

    // Tool with authorization
    this.strategy.registerTool({
      name: 'public-search',
      description: 'Public search endpoint',
      isPublic: true,
      handler: async () => {
        return { content: [{ type: 'text', text: 'Results...' }] };
      },
    });

    this.strategy.registerTool({
      name: 'admin-operation',
      description: 'Administrative operation',
      requiredScopes: ['admin', 'write'],
      requiredRoles: ['admin'],
      handler: async (args, context, request) => {
        const user = request?.user;
        return {
          content: [{ type: 'text', text: `Admin action by ${user?.name}` }],
        };
      },
    });

    // Resources
    this.strategy.registerResource({
      uri: 'mcp://app-config',
      name: 'app-config',
      description: 'Application configuration',
      mimeType: 'application/json',
      handler: async () => {
        return {
          contents: [
            {
              uri: 'mcp://app-config',
              mimeType: 'application/json',
              text: JSON.stringify({ env: 'production', version: '2.0.0' }),
            },
          ],
        };
      },
    });

    // Prompts
    this.strategy.registerPrompt({
      name: 'summarize',
      description: 'Summarize the provided text',
      parameters: z.object({
        text: z.string().describe('The text to summarize'),
        style: z.enum(['brief', 'detailed']).optional(),
      }),
      handler: async (args) => {
        return {
          description: 'Summarize the provided text',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please summarize in ${args?.style ?? 'brief'} style:\n\n${args?.text}`,
              },
            },
          ],
        };
      },
    });

    this.strategy.registerPrompt({
      name: 'greeting',
      description: 'A simple greeting prompt',
      handler: async () => ({
        description: 'A simple greeting prompt',
        messages: [{ role: 'user', content: { type: 'text', text: 'Hello!' } }],
      }),
    });

    // Deregistration: a tool that is removed and never re-registered
    this.strategy.registerTool({
      name: 'gone-tool',
      description: 'Will be removed before the server starts serving',
      handler: async () => ({ content: [{ type: 'text', text: 'unreachable' }] }),
    });
    this.strategy.removeTool('gone-tool');

    // Deregistration: a resource that is removed and never re-registered
    this.strategy.registerResource({
      uri: 'mcp://gone-resource',
      name: 'gone-resource',
      handler: async () => ({
        contents: [{ uri: 'mcp://gone-resource', text: 'unreachable' }],
      }),
    });
    this.strategy.removeResource('mcp://gone-resource');

    // Deregistration: a prompt that is removed and never re-registered
    this.strategy.registerPrompt({
      name: 'gone-prompt',
      description: 'Will be removed before the server starts serving',
      handler: async () => ({
        description: 'unreachable',
        messages: [{ role: 'user', content: { type: 'text', text: 'unreachable' } }],
      }),
    });
    this.strategy.removePrompt('gone-prompt');

    // Deregistration: remove then re-register with a new handler
    this.strategy.registerTool({
      name: 'my-tool',
      description: 'v1',
      handler: async () => ({ content: [{ type: 'text', text: 'old result' }] }),
    });
    this.strategy.removeTool('my-tool');
    this.strategy.registerTool({
      name: 'my-tool',
      description: 'Updated version',
      handler: async () => ({ content: [{ type: 'text', text: 'new result' }] }),
    });

    // Mixed mode: dynamic tool alongside the static @McpController tool
    this.strategy.registerTool({
      name: 'dynamic-tool',
      description: 'A dynamically registered tool',
      handler: async () => ({
        content: [{ type: 'text', text: 'Dynamic result' }],
      }),
    });
  }
}
