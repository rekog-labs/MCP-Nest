import { INestApplication, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { MCP_STRATEGY, McpController, McpStrategy, Tool } from '../src';
import { bootstrapMcpApp, createStreamableClient } from './utils';
import { z } from 'zod';

/**
 * Test Suite: Dynamic Tool Registration via the McpStrategy
 *
 * Validates that tools can be registered programmatically at runtime
 * through the strategy instance, in addition to decorator-based tools.
 *
 * This enables:
 * - Tools with dynamic descriptions from databases
 * - Plugin systems with runtime tool registration
 * - Mixed decorator and dynamic tool registration
 */

// ============================================================================
// Test Setup: Dynamic tool registration service (mirrors the old OnModuleInit
// pattern by injecting the strategy via the MCP_STRATEGY token).
// ============================================================================

const COLLECTIONS = ['documents', 'knowledge', 'faq'];

@Injectable()
class DynamicToolsService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'search-knowledge',
      description: `Search the knowledge base. Available collections: ${COLLECTIONS.join(', ')}`,
      parameters: z.object({
        query: z.string().describe('Search query'),
        collection: z.string().optional().describe('Filter by collection'),
        limit: z.number().default(5).describe('Max results'),
      }),
      annotations: { readOnlyHint: true },
      handler: async (args) => {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                query: args.query,
                collection: args.collection || 'all',
                results: [
                  `Result 1 for "${args.query}"`,
                  `Result 2 for "${args.query}"`,
                ],
              }),
            },
          ],
        };
      },
    });

    this.strategy.registerTool({
      name: 'get-collections',
      description: 'Get available collections',
      handler: async () => {
        return {
          content: [{ type: 'text', text: JSON.stringify(COLLECTIONS) }],
        };
      },
    });
  }
}

// ============================================================================
// Test Setup: Decorator-based tools (for mixed mode testing)
// ============================================================================

@McpController()
class StaticTools {
  @Tool({
    name: 'static-tool',
    description: 'A statically defined tool using decorators',
    parameters: z.object({ input: z.string() }),
  })
  staticTool(@Payload() { input }: { input: string }) {
    return {
      content: [{ type: 'text', text: `Static result: ${input}` }],
    };
  }
}

// ============================================================================
// Test Setup: Dynamic tool with output schema validation
// ============================================================================

@Injectable()
class OutputSchemaToolService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'structured-output-tool',
      description: 'A tool with output schema validation',
      parameters: z.object({ id: z.string() }),
      outputSchema: z.object({
        id: z.string(),
        name: z.string(),
        active: z.boolean(),
      }),
      handler: async (args) => {
        // Return structured data that matches the outputSchema
        return {
          id: args.id as string,
          name: `Item ${args.id}`,
          active: true,
        };
      },
    });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Dynamic Tool Registration via McpStrategy', () => {
  describe('Basic Dynamic Tools', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const { app: a, port } = await bootstrapMcpApp({
        name: 'basic-server',
        controllers: [],
        providers: [DynamicToolsService],
      });
      app = a;
      serverPort = port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list dynamically registered tools', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const tools = await client.listTools();

        expect(
          tools.tools.find((t) => t.name === 'search-knowledge'),
        ).toBeDefined();
        expect(
          tools.tools.find((t) => t.name === 'get-collections'),
        ).toBeDefined();

        // Verify description includes dynamic content
        const searchTool = tools.tools.find(
          (t) => t.name === 'search-knowledge',
        );
        expect(searchTool?.description).toContain('documents, knowledge, faq');
      } finally {
        await client.close();
      }
    });

    it('should execute dynamically registered tools', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result: any = await client.callTool({
          name: 'search-knowledge',
          arguments: { query: 'test query', collection: 'documents' },
        });

        const parsed = JSON.parse(result.content[0].text);
        expect(parsed.query).toBe('test query');
        expect(parsed.collection).toBe('documents');
        expect(parsed.results).toHaveLength(2);
      } finally {
        await client.close();
      }
    });

    it('should execute dynamic tool without parameters', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result: any = await client.callTool({
          name: 'get-collections',
          arguments: {},
        });

        const collections = JSON.parse(result.content[0].text);
        expect(collections).toEqual(['documents', 'knowledge', 'faq']);
      } finally {
        await client.close();
      }
    });

    it('should have correct input schema for dynamic tools', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const tools = await client.listTools();
        const searchTool = tools.tools.find(
          (t) => t.name === 'search-knowledge',
        );

        expect(searchTool?.inputSchema).toBeDefined();
        expect(searchTool?.inputSchema?.properties?.query).toBeDefined();
        expect(searchTool?.inputSchema?.properties?.collection).toBeDefined();
        expect(searchTool?.inputSchema?.properties?.limit).toBeDefined();
      } finally {
        await client.close();
      }
    });
  });

  describe('Mixed Mode (Decorator + Dynamic Tools)', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const { app: a, port } = await bootstrapMcpApp({
        name: 'mixed-server',
        controllers: [StaticTools],
        providers: [DynamicToolsService],
      });
      app = a;
      serverPort = port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list both decorator and dynamic tools', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const tools = await client.listTools();

        // Dynamic tools
        expect(
          tools.tools.find((t) => t.name === 'search-knowledge'),
        ).toBeDefined();
        expect(
          tools.tools.find((t) => t.name === 'get-collections'),
        ).toBeDefined();

        // Decorator-based tool
        expect(tools.tools.find((t) => t.name === 'static-tool')).toBeDefined();

        expect(tools.tools.length).toBe(3);
      } finally {
        await client.close();
      }
    });

    it('should execute decorator-based tool alongside dynamic tools', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result: any = await client.callTool({
          name: 'static-tool',
          arguments: { input: 'hello' },
        });

        expect(result.content[0].text).toBe('Static result: hello');
      } finally {
        await client.close();
      }
    });
  });

  describe('Output Schema Validation', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const { app: a, port } = await bootstrapMcpApp({
        name: 'output-schema-server',
        controllers: [],
        providers: [OutputSchemaToolService],
      });
      app = a;
      serverPort = port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should have outputSchema in tool listing', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const tools = await client.listTools();
        const tool = tools.tools.find(
          (t) => t.name === 'structured-output-tool',
        );

        expect(tool?.outputSchema).toBeDefined();
        expect(tool?.outputSchema?.properties?.id).toBeDefined();
        expect(tool?.outputSchema?.properties?.name).toBeDefined();
        expect(tool?.outputSchema?.properties?.active).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should return structured content for tools with outputSchema', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result: any = await client.callTool({
          name: 'structured-output-tool',
          arguments: { id: '123' },
        });

        // Should have structuredContent when outputSchema is defined
        expect(result.structuredContent).toBeDefined();
        expect(result.structuredContent.id).toBe('123');
        expect(result.structuredContent.name).toBe('Item 123');
        expect(result.structuredContent.active).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  describe('Multi-Server Isolation', () => {
    let app1: INestApplication;
    let app2: INestApplication;
    let port1: number;
    let port2: number;

    beforeAll(async () => {
      const server1 = await bootstrapMcpApp({
        name: 'multi-server-1',
        controllers: [],
      });
      app1 = server1.app;
      port1 = server1.port;
      server1.strategy.registerTool({
        name: 'server1-dynamic-tool',
        description: 'Dynamic tool for server 1',
        handler: async () => ({
          content: [{ type: 'text', text: 'Server 1 dynamic' }],
        }),
      });

      const server2 = await bootstrapMcpApp({
        name: 'multi-server-2',
        controllers: [],
      });
      app2 = server2.app;
      port2 = server2.port;
      server2.strategy.registerTool({
        name: 'server2-dynamic-tool',
        description: 'Dynamic tool for server 2',
        handler: async () => ({
          content: [{ type: 'text', text: 'Server 2 dynamic' }],
        }),
      });
    });

    afterAll(async () => {
      await app1.close();
      await app2.close();
    });

    it('should register dynamic tools to correct server (server 1)', async () => {
      const client = await createStreamableClient(port1);
      try {
        const tools = await client.listTools();

        expect(
          tools.tools.find((t) => t.name === 'server1-dynamic-tool'),
        ).toBeDefined();
        expect(
          tools.tools.find((t) => t.name === 'server2-dynamic-tool'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should register dynamic tools to correct server (server 2)', async () => {
      const client = await createStreamableClient(port2);
      try {
        const tools = await client.listTools();

        expect(
          tools.tools.find((t) => t.name === 'server2-dynamic-tool'),
        ).toBeDefined();
        expect(
          tools.tools.find((t) => t.name === 'server1-dynamic-tool'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should execute tools on their respective servers', async () => {
      const client1 = await createStreamableClient(port1);
      const client2 = await createStreamableClient(port2);

      try {
        const result1: any = await client1.callTool({
          name: 'server1-dynamic-tool',
          arguments: {},
        });
        expect(result1.content[0].text).toBe('Server 1 dynamic');

        const result2: any = await client2.callTool({
          name: 'server2-dynamic-tool',
          arguments: {},
        });
        expect(result2.content[0].text).toBe('Server 2 dynamic');
      } finally {
        await client1.close();
        await client2.close();
      }
    });
  });

  describe('Deregistration', () => {
    let app: INestApplication;
    let serverPort: number;
    let strategy: McpStrategy;

    beforeAll(async () => {
      const result = await bootstrapMcpApp({
        name: 'dereg-server',
        controllers: [],
        providers: [DynamicToolsService],
      });
      app = result.app;
      serverPort = result.port;
      strategy = result.strategy;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should remove a tool from the listing', async () => {
      strategy.registerTool({
        name: 'temp-tool',
        description: 'Temporary tool',
        handler: async () => ({ content: [{ type: 'text', text: 'temp' }] }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        let tools = await client.listTools();
        expect(tools.tools.find((t) => t.name === 'temp-tool')).toBeDefined();

        strategy.removeTool('temp-tool');

        tools = await client.listTools();
        expect(tools.tools.find((t) => t.name === 'temp-tool')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should return an error when calling a removed tool', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        await expect(
          client.callTool({ name: 'temp-tool', arguments: {} }),
        ).rejects.toThrow();
      } finally {
        await client.close();
      }
    });

    it('should not affect other tools when one is removed', async () => {
      strategy.registerTool({
        name: 'tool-to-keep',
        description: 'Should remain',
        handler: async () => ({ content: [{ type: 'text', text: 'kept' }] }),
      });
      strategy.registerTool({
        name: 'tool-to-remove',
        description: 'Should be removed',
        handler: async () => ({ content: [{ type: 'text', text: 'gone' }] }),
      });

      strategy.removeTool('tool-to-remove');

      const client = await createStreamableClient(serverPort);
      try {
        const tools = await client.listTools();
        expect(
          tools.tools.find((t) => t.name === 'tool-to-keep'),
        ).toBeDefined();
        expect(
          tools.tools.find((t) => t.name === 'tool-to-remove'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should reflect a newly registered tool on a running server', async () => {
      strategy.registerTool({
        name: 'hot-registered-tool',
        description: 'Registered after server started',
        handler: async () => ({ content: [{ type: 'text', text: 'hot' }] }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        const tools = await client.listTools();
        expect(
          tools.tools.find((t) => t.name === 'hot-registered-tool'),
        ).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should re-register a tool after removal', async () => {
      strategy.registerTool({
        name: 'reregistered-tool',
        description: 'Original',
        handler: async () => ({
          content: [{ type: 'text', text: 'original' }],
        }),
      });
      strategy.removeTool('reregistered-tool');
      strategy.registerTool({
        name: 'reregistered-tool',
        description: 'Replacement',
        handler: async () => ({
          content: [{ type: 'text', text: 'replacement' }],
        }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        const tools = await client.listTools();
        const matches = tools.tools.filter(
          (t) => t.name === 'reregistered-tool',
        );
        expect(matches).toHaveLength(1);
        expect(matches[0].description).toBe('Replacement');

        const result: any = await client.callTool({
          name: 'reregistered-tool',
          arguments: {},
        });
        expect(result.content[0].text).toBe('replacement');
      } finally {
        await client.close();
      }
    });

    it('should overwrite a tool when registered with the same name', async () => {
      strategy.registerTool({
        name: 'duplicate-tool',
        description: 'First version',
        handler: async () => ({ content: [{ type: 'text', text: 'first' }] }),
      });
      strategy.registerTool({
        name: 'duplicate-tool',
        description: 'Second version',
        handler: async () => ({ content: [{ type: 'text', text: 'second' }] }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        const tools = await client.listTools();
        const matches = tools.tools.filter((t) => t.name === 'duplicate-tool');
        expect(matches).toHaveLength(1);
        expect(matches[0].description).toBe('Second version');

        const result: any = await client.callTool({
          name: 'duplicate-tool',
          arguments: {},
        });
        expect(result.content[0].text).toBe('second');
      } finally {
        await client.close();
      }
    });
  });
});
