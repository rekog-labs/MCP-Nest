import { INestApplication, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Tool, Resource, Prompt } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { createStreamableClient } from './utils';
import { z } from 'zod';

/**
 * Test Suite: McpModule.forFeature()
 *
 * Validates that tools, resources, and prompts can be registered to specific MCP servers
 * using McpModule.forFeature(), allowing for modular organization of MCP capabilities.
 *
 * This pattern enables:
 * - Domain-organized modules with their own tools
 * - Clear association between tools and their target MCP server
 * - Modularity without dependency coupling
 */

// ============================================================================
// Test Setup: Create test tools and modules
// ============================================================================

@Injectable()
class UserService {
  getUser(id: string) {
    return { id, name: `User ${id}`, email: `user${id}@example.com` };
  }

  listUsers() {
    return [
      { id: '1', name: 'User 1' },
      { id: '2', name: 'User 2' },
    ];
  }
}

@Injectable()
class UserTools {
  constructor(private readonly userService: UserService) {}

  @Tool({
    name: 'get-user',
    description: 'Get a user by ID',
    parameters: z.object({ id: z.string() }),
  })
  getUser({ id }: { id: string }) {
    const user = this.userService.getUser(id);
    return { content: [{ type: 'text', text: JSON.stringify(user) }] };
  }

  @Tool({
    name: 'list-users',
    description: 'List all users',
  })
  listUsers() {
    const users = this.userService.listUsers();
    return { content: [{ type: 'text', text: JSON.stringify(users) }] };
  }
}

@Injectable()
class OrderService {
  getOrder(id: string) {
    return { id, product: 'Widget', quantity: 5, status: 'shipped' };
  }
}

@Injectable()
class OrderTools {
  constructor(private readonly orderService: OrderService) {}

  @Tool({
    name: 'get-order',
    description: 'Get an order by ID',
    parameters: z.object({ id: z.string() }),
  })
  getOrder({ id }: { id: string }) {
    const order = this.orderService.getOrder(id);
    return { content: [{ type: 'text', text: JSON.stringify(order) }] };
  }
}

@Injectable()
class AnalyticsTools {
  @Tool({
    name: 'get-analytics',
    description: 'Get analytics data',
  })
  getAnalytics() {
    return {
      content: [{ type: 'text', text: 'Analytics data: 1000 visits' }],
    };
  }
}

@Injectable()
class ResourceProvider {
  @Resource({
    uri: 'feature://config',
    name: 'feature-config',
    description: 'Feature configuration resource',
  })
  getConfig() {
    return {
      contents: [
        {
          uri: 'feature://config',
          text: JSON.stringify({ feature: 'enabled' }),
        },
      ],
    };
  }
}

@Injectable()
class PromptProvider {
  @Prompt({
    name: 'feature-prompt',
    description: 'A feature prompt',
  })
  getPrompt() {
    return {
      messages: [
        { role: 'user', content: { type: 'text', text: 'Feature prompt' } },
      ],
    };
  }
}

// ============================================================================
// Feature Module: User domain tools
// ============================================================================
@Module({
  imports: [McpModule.forFeature([UserTools], 'main-server')],
  providers: [UserTools, UserService],
  exports: [],
})
class UserFeatureModule {}

// ============================================================================
// Feature Module: Order domain tools
// ============================================================================
@Module({
  imports: [McpModule.forFeature([OrderTools], 'main-server')],
  providers: [OrderTools, OrderService],
  exports: [OrderTools],
})
class OrderFeatureModule {}

// ============================================================================
// Feature Module: Analytics for a different server
// ============================================================================
@Module({
  imports: [McpModule.forFeature([AnalyticsTools], 'analytics-server')],
  providers: [AnalyticsTools],
  exports: [AnalyticsTools],
})
class AnalyticsFeatureModule {}

// ============================================================================
// Feature Module: Resources and Prompts
// ============================================================================
@Module({
  imports: [
    McpModule.forFeature([ResourceProvider, PromptProvider], 'main-server'),
  ],
  providers: [ResourceProvider, PromptProvider],
  exports: [ResourceProvider, PromptProvider],
})
class ResourcesFeatureModule {}

// ============================================================================
// MCP Server Configurations
// ============================================================================
const mainServerModule = McpModule.forRoot({
  name: 'main-server',
  version: '1.0.0',
  mcpEndpoint: '/main/mcp',
  sseEndpoint: '/main/sse',
  messagesEndpoint: '/main/messages',
});

const analyticsServerModule = McpModule.forRoot({
  name: 'analytics-server',
  version: '1.0.0',
  mcpEndpoint: '/analytics/mcp',
  sseEndpoint: '/analytics/sse',
  messagesEndpoint: '/analytics/messages',
});

// ============================================================================
// App Module: Combines servers with feature modules
// ============================================================================
@Module({
  imports: [
    mainServerModule,
    analyticsServerModule,
    UserFeatureModule,
    OrderFeatureModule,
    AnalyticsFeatureModule,
    ResourcesFeatureModule,
  ],
  // Note: No providers with @Tool decorators here - all tools come from feature modules
})
class AppModule {}

// ============================================================================
// Test: Multiple feature modules targeting different servers
// ============================================================================
@Module({
  imports: [McpModule.forFeature([UserTools, OrderTools], 'combined-server')],
  providers: [UserTools, UserService, OrderTools, OrderService],
  exports: [UserTools, OrderTools],
})
class CombinedFeatureModule {}

const combinedServerModule = McpModule.forRoot({
  name: 'combined-server',
  version: '1.0.0',
  mcpEndpoint: '/combined/mcp',
  sseEndpoint: '/combined/sse',
  messagesEndpoint: '/combined/messages',
});

@Module({
  imports: [combinedServerModule, CombinedFeatureModule],
})
class CombinedAppModule {}

describe('E2E: McpModule.forFeature() (Streamable HTTP)', () => {
  let app: INestApplication;
  let combinedApp: INestApplication;
  let serverPort: number;
  let combinedServerPort: number;

  jest.setTimeout(15000);

  beforeAll(async () => {
    // Create main app with multiple servers and feature modules
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    if (!server.address()) {
      throw new Error('Server address not found after listen');
    }
    serverPort = (server.address() as import('net').AddressInfo).port;

    // Create combined app
    const combinedModuleFixture: TestingModule = await Test.createTestingModule(
      {
        imports: [CombinedAppModule],
      },
    ).compile();

    combinedApp = combinedModuleFixture.createNestApplication();
    await combinedApp.listen(0);

    const combinedServer = combinedApp.getHttpServer();
    if (!combinedServer.address()) {
      throw new Error('Combined server address not found after listen');
    }
    combinedServerPort = (combinedServer.address() as import('net').AddressInfo)
      .port;
  });

  afterAll(async () => {
    await app.close();
    await combinedApp.close();
  });

  describe('Main Server - Should have tools from UserFeatureModule and OrderFeatureModule', () => {
    it('should list user and order tools registered via forFeature', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/main/mcp',
      });
      try {
        const tools = await client.listTools();

        // Should have tools from both feature modules
        expect(tools.tools.find((t) => t.name === 'get-user')).toBeDefined();
        expect(tools.tools.find((t) => t.name === 'list-users')).toBeDefined();
        expect(tools.tools.find((t) => t.name === 'get-order')).toBeDefined();

        // Should NOT have analytics tools (registered to different server)
        expect(
          tools.tools.find((t) => t.name === 'get-analytics'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should call tools registered via forFeature', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/main/mcp',
      });
      try {
        const result: any = await client.callTool({
          name: 'get-user',
          arguments: { id: '123' },
        });

        const user = JSON.parse(result.content[0].text);
        expect(user.id).toBe('123');
        expect(user.name).toBe('User 123');
      } finally {
        await client.close();
      }
    });

    it('should have resources registered via forFeature', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/main/mcp',
      });
      try {
        const resources = await client.listResources();
        expect(
          resources.resources.find((r) => r.name === 'feature-config'),
        ).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should have prompts registered via forFeature', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/main/mcp',
      });
      try {
        const prompts = await client.listPrompts();
        expect(
          prompts.prompts.find((p) => p.name === 'feature-prompt'),
        ).toBeDefined();
      } finally {
        await client.close();
      }
    });
  });

  describe('Analytics Server - Should have tools from AnalyticsFeatureModule only', () => {
    it('should list only analytics tools', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/analytics/mcp',
      });
      try {
        const tools = await client.listTools();

        // Should have analytics tools
        expect(
          tools.tools.find((t) => t.name === 'get-analytics'),
        ).toBeDefined();

        // Should NOT have user/order tools
        expect(tools.tools.find((t) => t.name === 'get-user')).toBeUndefined();
        expect(
          tools.tools.find((t) => t.name === 'list-users'),
        ).toBeUndefined();
        expect(tools.tools.find((t) => t.name === 'get-order')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should call analytics tool', async () => {
      const client = await createStreamableClient(serverPort, {
        endpoint: '/analytics/mcp',
      });
      try {
        const result: any = await client.callTool({
          name: 'get-analytics',
          arguments: {},
        });

        expect(result.content[0].text).toBe('Analytics data: 1000 visits');
      } finally {
        await client.close();
      }
    });
  });

  describe('Combined Feature Module - Multiple providers in single forFeature call', () => {
    it('should list tools from multiple providers registered in single forFeature', async () => {
      const client = await createStreamableClient(combinedServerPort, {
        endpoint: '/combined/mcp',
      });
      try {
        const tools = await client.listTools();

        // Should have tools from both UserTools and OrderTools
        expect(tools.tools.find((t) => t.name === 'get-user')).toBeDefined();
        expect(tools.tools.find((t) => t.name === 'list-users')).toBeDefined();
        expect(tools.tools.find((t) => t.name === 'get-order')).toBeDefined();

        // Verify exact count
        expect(tools.tools.length).toBe(3);
      } finally {
        await client.close();
      }
    });
  });

  describe('Server isolation - forFeature tools go to correct server', () => {
    it('should not register tools to wrong server even when forFeature targets different server', async () => {
      // This test verifies that when forFeature targets a server that exists,
      // tools only go to that specific server, not others
      const client = await createStreamableClient(serverPort, {
        endpoint: '/main/mcp',
      });
      try {
        const tools = await client.listTools();

        // Main server should NOT have analytics tools (they go to analytics-server)
        expect(
          tools.tools.find((t) => t.name === 'get-analytics'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });
  });
});
