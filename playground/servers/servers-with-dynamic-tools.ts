import {
  Inject,
  Injectable,
  Module,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Payload } from '@nestjs/microservices';
import {
  MCP_STRATEGY,
  McpController,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { z } from 'zod';

/**
 * Playground: Dynamic Tool Registration Example
 *
 * This example demonstrates:
 * 1. Two MCP servers running on different ports
 * 2. Server 1 (port 3031): Only has static decorator-based tools
 * 3. Server 2 (port 3032): Has both static tools AND dynamic tools registered at runtime
 *
 * Dynamic tools are registered on the McpStrategy instance (injected via the
 * `MCP_STRATEGY` token) in the onApplicationBootstrap lifecycle hook. The old
 * global `McpRegistryService` is gone — register on the strategy instead. This
 * lets you:
 * - Load tool descriptions from databases
 * - Create tools based on runtime configuration
 * - Build plugin systems with runtime tool registration
 *
 * Test the servers:
 *
 * # Start both servers
 * npx ts-node-dev --respawn ./playground/servers/servers-with-dynamic-tools.ts
 *
 * # List tools on Server 1 (static tools only)
 * bunx @modelcontextprotocol/inspector --cli "http://localhost:3031/mcp" --transport http --method tools/list
 *
 * # List tools on Server 2 (static + dynamic tools)
 * bunx @modelcontextprotocol/inspector --cli "http://localhost:3032/mcp" --transport http --method tools/list
 */

// ============================================================================
// Static Tool (Decorator-based) - Used by both servers
// ============================================================================

@McpController()
class SimpleGreetingTool {
  @Tool({
    name: 'greet-static',
    description: 'A static greeting tool defined using decorators',
    parameters: z.object({
      name: z.string().describe('Name of the person to greet'),
    }),
  })
  greetStatic(@Payload() { name }: { name: string }) {
    return {
      content: [{ type: 'text', text: `Hello ${name}! (from static tool)` }],
    };
  }
}

// ============================================================================
// Dynamic Tools Service - Registers tools programmatically at runtime
// ============================================================================

@Injectable()
class DynamicToolsService implements OnApplicationBootstrap {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  /**
   * onApplicationBootstrap runs before the server starts accepting requests.
   * This is where you register dynamic tools on the injected McpStrategy.
   */
  async onApplicationBootstrap() {
    console.log('📝 Registering dynamic tools...');

    // Simulate fetching available collections from a database
    const collections = await this.loadCollectionsFromDatabase();

    // Register a dynamic search tool with description built from DB data
    this.strategy.registerTool({
      name: 'search-dynamic',
      description: `Search across collections. Available: ${collections.join(', ')}`,
      parameters: z.object({
        query: z.string().describe('Search query'),
        collection: z
          .enum(collections as [string, ...string[]])
          .optional()
          .describe('Filter by collection'),
        limit: z.number().default(10).describe('Max results to return'),
      }),
      annotations: {
        readOnlyHint: true,
        title: 'Dynamic Search Tool',
      },
      handler: async (args) => {
        // Handler has access to DI services via closure
        const results = await this.performSearch(
          args.query as string,
          args.collection as string | undefined,
          args.limit as number,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(results, null, 2) }],
        };
      },
    });

    // Register another dynamic tool
    this.strategy.registerTool({
      name: 'get-collections',
      description: 'Get list of available collections',
      handler: async () => {
        const collections = await this.loadCollectionsFromDatabase();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ collections }, null, 2),
            },
          ],
        };
      },
    });

    // Register a dynamic tool with structured output
    this.strategy.registerTool({
      name: 'get-stats',
      description: 'Get search statistics with structured output',
      outputSchema: z.object({
        totalDocs: z.number(),
        collections: z.array(z.string()),
        lastUpdated: z.string(),
      }),
      handler: async () => {
        // Return structured data matching the outputSchema
        return {
          totalDocs: 12543,
          collections: await this.loadCollectionsFromDatabase(),
          lastUpdated: new Date().toISOString(),
        };
      },
    });

    console.log('✅ Dynamic tools registered successfully');
  }

  // Simulate database operations
  // eslint-disable-next-line @typescript-eslint/require-await
  private async loadCollectionsFromDatabase(): Promise<string[]> {
    // In a real app, this would query your database
    return ['documents', 'knowledge-base', 'faq', 'tutorials'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async performSearch(
    query: string,
    collection?: string,
    limit: number = 10,
  ): Promise<any> {
    // In a real app, this would perform actual search
    return {
      query,
      collection: collection || 'all',
      limit,
      results: [
        { id: 1, title: `Result 1 for "${query}"`, score: 0.95 },
        { id: 2, title: `Result 2 for "${query}"`, score: 0.87 },
      ],
    };
  }
}

// ============================================================================
// Server 1: Static Tools Only
// ============================================================================

const staticStrategy = new McpStrategy({
  name: 'static-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ endpoint: '/mcp' })],
  logging: false,
});

@Module({
  controllers: [SimpleGreetingTool],
})
class StaticServerModule {}

// ============================================================================
// Server 2: Static + Dynamic Tools
// ============================================================================

const dynamicStrategy = new McpStrategy({
  name: 'dynamic-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ endpoint: '/mcp' })],
  logging: false,
});

@Module({
  controllers: [SimpleGreetingTool], // Static decorator-based tool
  providers: [
    DynamicToolsService, // Service that registers dynamic tools
    { provide: MCP_STRATEGY, useValue: dynamicStrategy },
  ],
})
class DynamicServerModule {}

// ============================================================================
// Bootstrap Both Servers
// ============================================================================

async function bootstrap() {
  console.log('🚀 Starting MCP servers...\n');

  // Start Server 1 on port 3031 (static tools only)
  const app1 = await NestFactory.create(StaticServerModule, { logger: false });
  staticStrategy.setHttpAdapter(app1.getHttpAdapter());
  app1.connectMicroservice({ strategy: staticStrategy });
  await app1.startAllMicroservices();
  await app1.listen(3031);
  console.log('✅ Server 1 (Static Tools) started on port 3031');
  console.log(
    '   Test: bunx @modelcontextprotocol/inspector --cli "http://localhost:3031/mcp" --transport http --method tools/list\n',
  );

  // Start Server 2 on port 3032 (static + dynamic tools)
  const app2 = await NestFactory.create(DynamicServerModule, { logger: false });
  dynamicStrategy.setHttpAdapter(app2.getHttpAdapter());
  app2.connectMicroservice({ strategy: dynamicStrategy });
  await app2.startAllMicroservices();
  await app2.listen(3032);
  console.log('✅ Server 2 (Static + Dynamic Tools) started on port 3032');
  console.log(
    '   Test: bunx @modelcontextprotocol/inspector --cli "http://localhost:3032/mcp" --transport http --method tools/list\n',
  );

  console.log('📋 Expected Results:');
  console.log('   Server 1: Should show 1 tool (greet-static)');
  console.log(
    '   Server 2: Should show 4 tools (greet-static, search-dynamic, get-collections, get-stats)\n',
  );
}

void bootstrap();
