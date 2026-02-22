import {
  INestApplication,
  Injectable,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Tool, McpDynamicCapabilityRegistryService } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { createStreamableClient } from './utils';
import { z } from 'zod';

/**
 * Test Suite: Dynamic Tool Registration via McpDynamicCapabilityRegistryService
 *
 * Validates that tools can be registered programmatically at runtime
 * using the McpDynamicCapabilityRegistryService service, in addition to decorator-based tools.
 *
 * This enables:
 * - Tools with dynamic descriptions from databases
 * - Plugin systems with runtime tool registration
 * - Mixed decorator and dynamic tool registration
 */

// ============================================================================
// Test Setup: Dynamic tool registration service
// ============================================================================

@Injectable()
class DynamicToolsService implements OnModuleInit {
  constructor(private readonly toolBuilder: McpDynamicCapabilityRegistryService) {}

  async onModuleInit() {
    // Simulate loading tool configuration from a database
    const collections = ['documents', 'knowledge', 'faq'];

    this.toolBuilder.registerTool({
      name: 'search-knowledge',
      description: `Search the knowledge base. Available collections: ${collections.join(', ')}`,
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

    // Register another dynamic tool
    this.toolBuilder.registerTool({
      name: 'get-collections',
      description: 'Get available collections',
      handler: async () => {
        return {
          content: [{ type: 'text', text: JSON.stringify(collections) }],
        };
      },
    });
  }
}

// ============================================================================
// Test Setup: Decorator-based tools (for mixed mode testing)
// ============================================================================

@Injectable()
class StaticTools {
  @Tool({
    name: 'static-tool',
    description: 'A statically defined tool using decorators',
    parameters: z.object({ input: z.string() }),
  })
  staticTool({ input }: { input: string }) {
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
  constructor(private readonly toolBuilder: McpDynamicCapabilityRegistryService) {}

  onModuleInit() {
    this.toolBuilder.registerTool({
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
// Test Setup: Multi-server dynamic tool registration
// ============================================================================

@Injectable()
class Server1DynamicTools implements OnModuleInit {
  constructor(private readonly toolBuilder: McpDynamicCapabilityRegistryService) {}

  onModuleInit() {
    this.toolBuilder.registerTool({
      name: 'server1-dynamic-tool',
      description: 'Dynamic tool for server 1',
      handler: async () => {
        return { content: [{ type: 'text', text: 'Server 1 dynamic' }] };
      },
    });
  }
}

@Injectable()
class Server2DynamicTools implements OnModuleInit {
  constructor(private readonly toolBuilder: McpDynamicCapabilityRegistryService) {}

  onModuleInit() {
    this.toolBuilder.registerTool({
      name: 'server2-dynamic-tool',
      description: 'Dynamic tool for server 2',
      handler: async () => {
        return { content: [{ type: 'text', text: 'Server 2 dynamic' }] };
      },
    });
  }
}

// ============================================================================
// Module: Basic dynamic tools
// ============================================================================

const deregServerModule = McpModule.forRoot({
  name: 'dereg-server',
  version: '1.0.0',
  mcpEndpoint: '/dereg/mcp',
});

@Module({
  imports: [deregServerModule],
  providers: [DynamicToolsService],
})
class DeregistrationToolsAppModule {}

const basicServerModule = McpModule.forRoot({
  name: 'basic-server',
  version: '1.0.0',
  mcpEndpoint: '/basic/mcp',
});

@Module({
  imports: [basicServerModule],
  providers: [DynamicToolsService],
})
class BasicDynamicToolsAppModule {}

// ============================================================================
// Module: Mixed mode (decorator + dynamic tools)
// ============================================================================

const mixedServerModule = McpModule.forRoot({
  name: 'mixed-server',
  version: '1.0.0',
  mcpEndpoint: '/mixed/mcp',
});

@Module({
  imports: [mixedServerModule],
  providers: [DynamicToolsService, StaticTools],
})
class MixedToolsAppModule {}

// ============================================================================
// Module: Output schema validation
// ============================================================================

const outputSchemaServerModule = McpModule.forRoot({
  name: 'output-schema-server',
  version: '1.0.0',
  mcpEndpoint: '/output-schema/mcp',
});

@Module({
  imports: [outputSchemaServerModule],
  providers: [OutputSchemaToolService],
})
class OutputSchemaAppModule {}

// ============================================================================
// Module: Multi-server isolation
// ============================================================================

const multiServer1Module = McpModule.forRoot({
  name: 'multi-server-1',
  version: '1.0.0',
  mcpEndpoint: '/multi1/mcp',
});

const multiServer2Module = McpModule.forRoot({
  name: 'multi-server-2',
  version: '1.0.0',
  mcpEndpoint: '/multi2/mcp',
});

@Module({
  imports: [multiServer1Module],
  providers: [Server1DynamicTools],
})
class MultiServer1Module {}

@Module({
  imports: [multiServer2Module],
  providers: [Server2DynamicTools],
})
class MultiServer2Module {}

@Module({
  imports: [MultiServer1Module, MultiServer2Module],
})
class MultiServerAppModule {}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Dynamic Tool Registration via McpDynamicCapabilityRegistryService', () => {
  jest.setTimeout(15000);

  describe('Basic Dynamic Tools', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [BasicDynamicToolsAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);

      const server = app.getHttpServer();
      serverPort = (server.address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list dynamically registered tools', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/basic/mcp',
      });
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
      const client = await createStreamableClient(serverPort, {
        endpoint: '/basic/mcp',
      });
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
      const client = await createStreamableClient(serverPort, {
        endpoint: '/basic/mcp',
      });
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
      const client = await createStreamableClient(serverPort, {
        endpoint: '/basic/mcp',
      });
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
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [MixedToolsAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);

      const server = app.getHttpServer();
      serverPort = (server.address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list both decorator and dynamic tools', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/mixed/mcp',
      });
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
      const client = await createStreamableClient(serverPort, {
        endpoint: '/mixed/mcp',
      });
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
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [OutputSchemaAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);

      const server = app.getHttpServer();
      serverPort = (server.address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should have outputSchema in tool listing', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/output-schema/mcp',
      });
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
      const client = await createStreamableClient(serverPort, {
        endpoint: '/output-schema/mcp',
      });
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
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [MultiServerAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);

      const server = app.getHttpServer();
      serverPort = (server.address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should register dynamic tools to correct server (server 1)', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/multi1/mcp',
      });
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
      const client = await createStreamableClient(serverPort, {
        endpoint: '/multi2/mcp',
      });
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
      const client1 = await createStreamableClient(serverPort, {
        endpoint: '/multi1/mcp',
      });
      const client2 = await createStreamableClient(serverPort, {
        endpoint: '/multi2/mcp',
      });

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
    let capabilityBuilder: McpDynamicCapabilityRegistryService;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [DeregistrationToolsAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
      capabilityBuilder = moduleFixture.get(McpDynamicCapabilityRegistryService, { strict: false });
    });

    afterAll(async () => {
      await app.close();
    });

    it('should remove a tool from the listing', async () => {
      capabilityBuilder.registerTool({
        name: 'temp-tool',
        description: 'Temporary tool',
        handler: async () => ({ content: [{ type: 'text', text: 'temp' }] }),
      });

      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        let tools = await client.listTools();
        expect(tools.tools.find((t) => t.name === 'temp-tool')).toBeDefined();

        capabilityBuilder.removeTool('temp-tool');

        tools = await client.listTools();
        expect(tools.tools.find((t) => t.name === 'temp-tool')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should return an error when calling a removed tool', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        await expect(
          client.callTool({ name: 'temp-tool', arguments: {} }),
        ).rejects.toThrow();
      } finally {
        await client.close();
      }
    });

    it('should not affect other tools when one is removed', async () => {
      capabilityBuilder.registerTool({
        name: 'tool-to-keep',
        description: 'Should remain',
        handler: async () => ({ content: [{ type: 'text', text: 'kept' }] }),
      });
      capabilityBuilder.registerTool({
        name: 'tool-to-remove',
        description: 'Should be removed',
        handler: async () => ({ content: [{ type: 'text', text: 'gone' }] }),
      });

      capabilityBuilder.removeTool('tool-to-remove');

      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        const tools = await client.listTools();
        expect(tools.tools.find((t) => t.name === 'tool-to-keep')).toBeDefined();
        expect(tools.tools.find((t) => t.name === 'tool-to-remove')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should reflect a newly registered tool on a running server', async () => {
      capabilityBuilder.registerTool({
        name: 'hot-registered-tool',
        description: 'Registered after server started',
        handler: async () => ({ content: [{ type: 'text', text: 'hot' }] }),
      });

      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        const tools = await client.listTools();
        expect(tools.tools.find((t) => t.name === 'hot-registered-tool')).toBeDefined();
      } finally {
        await client.close();
      }
    });
  });
});
