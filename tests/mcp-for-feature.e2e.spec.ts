import { INestApplication, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { McpController, Prompt, Resource, Tool } from '../src';
import {
  createStreamableClient,
  McpStrategy,
  StreamableHttpTransport,
} from './utils';
import { z } from 'zod';

/**
 * Test Suite: feature-module grouping of MCP capabilities
 *
 * ADAPTATION NOTE (microservices migration):
 * The legacy suite mounted several MCP servers in one app (separated by HTTP
 * endpoints) and registered capabilities to a named server purely via
 * `McpModule.forFeature([...], 'server-name')`. `McpModule` (and `forFeature`)
 * no longer exist. Under the microservice transport-strategy model:
 *   - An app hosts an `McpStrategy`, and the strategy scans ALL modules'
 *     controllers, binding every `@Tool`/`@Resource`/`@Prompt` it finds.
 *   - The "feature module" grouping intent is preserved by declaring each
 *     group of capability `@McpController`s in its own `@Module({ controllers })`
 *     and importing those feature modules into the app module — exactly the
 *     equivalent of the old `forFeature` grouping, minus the runtime binding
 *     responsibility (the strategy now binds, not the module).
 * Per-server isolation comes from each named server being its own hybrid app on
 * its own port, importing only the feature modules it owns.
 */

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

@McpController()
class UserTools {
  constructor(private readonly userService: UserService) {}

  @Tool({
    name: 'get-user',
    description: 'Get a user by ID',
    parameters: z.object({ id: z.string() }),
  })
  getUser(args: { id: string }) {
    const user = this.userService.getUser(args.id);
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

@McpController()
class OrderTools {
  constructor(private readonly orderService: OrderService) {}

  @Tool({
    name: 'get-order',
    description: 'Get an order by ID',
    parameters: z.object({ id: z.string() }),
  })
  getOrder(args: { id: string }) {
    const order = this.orderService.getOrder(args.id);
    return { content: [{ type: 'text', text: JSON.stringify(order) }] };
  }
}

@McpController()
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

@McpController()
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

@McpController()
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

// Feature modules group capability controllers, mirroring the old
// `forFeature([...])` grouping. The strategy scans the controllers of every
// imported module and binds their handlers.
@Module({
  controllers: [UserTools, OrderTools],
  providers: [UserService, OrderService],
})
class UserOrderFeatureModule {}

@Module({
  controllers: [ResourceProvider, PromptProvider],
})
class ResourcePromptFeatureModule {}

@Module({
  controllers: [AnalyticsTools],
})
class AnalyticsFeatureModule {}

async function bootstrapServer(config: {
  name: string;
  imports: any[];
}): Promise<{ app: INestApplication; port: number }> {
  const strategy = new McpStrategy({
    name: config.name,
    version: '1.0.0',
    transports: [new StreamableHttpTransport({ statelessMode: false })],
  });

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: config.imports,
  }).compile();

  const app = moduleFixture.createNestApplication();
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(0);
  const port = (app.getHttpServer().address() as { port: number }).port;
  return { app, port };
}

describe('E2E: feature-module grouping (Streamable HTTP)', () => {
  let mainApp: INestApplication;
  let analyticsApp: INestApplication;
  let combinedApp: INestApplication;
  let mainPort: number;
  let analyticsPort: number;
  let combinedPort: number;

  jest.setTimeout(15000);

  beforeAll(async () => {
    // Main server: user + order tools, plus a resource and a prompt, grouped
    // into two feature modules imported into the app.
    const main = await bootstrapServer({
      name: 'main-server',
      imports: [UserOrderFeatureModule, ResourcePromptFeatureModule],
    });
    mainApp = main.app;
    mainPort = main.port;

    // Analytics server: only the analytics feature module.
    const analytics = await bootstrapServer({
      name: 'analytics-server',
      imports: [AnalyticsFeatureModule],
    });
    analyticsApp = analytics.app;
    analyticsPort = analytics.port;

    // Combined server: the user/order feature module only.
    const combined = await bootstrapServer({
      name: 'combined-server',
      imports: [UserOrderFeatureModule],
    });
    combinedApp = combined.app;
    combinedPort = combined.port;
  });

  afterAll(async () => {
    await mainApp.close();
    await analyticsApp.close();
    await combinedApp.close();
  });

  describe('Main Server - Should have user and order capabilities', () => {
    it('should list user and order tools registered for the server', async () => {
      const client = await createStreamableClient(mainPort);
      try {
        const tools = await client.listTools();

        expect(tools.tools.find((t) => t.name === 'get-user')).toBeDefined();
        expect(tools.tools.find((t) => t.name === 'list-users')).toBeDefined();
        expect(tools.tools.find((t) => t.name === 'get-order')).toBeDefined();

        // Should NOT have analytics tools (registered to a different server)
        expect(
          tools.tools.find((t) => t.name === 'get-analytics'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should call tools registered for the server', async () => {
      const client = await createStreamableClient(mainPort);
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

    it('should have resources registered for the server', async () => {
      const client = await createStreamableClient(mainPort);
      try {
        const resources = await client.listResources();
        expect(
          resources.resources.find((r) => r.name === 'feature-config'),
        ).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should have prompts registered for the server', async () => {
      const client = await createStreamableClient(mainPort);
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

  describe('Analytics Server - Should have analytics tools only', () => {
    it('should list only analytics tools', async () => {
      const client = await createStreamableClient(analyticsPort);
      try {
        const tools = await client.listTools();

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
      const client = await createStreamableClient(analyticsPort);
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
    it('should list tools from multiple capability classes grouped in single forFeature', async () => {
      const client = await createStreamableClient(combinedPort);
      try {
        const tools = await client.listTools();

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

  describe('Server isolation - capabilities go to correct server', () => {
    it('should not register analytics tools on the main server', async () => {
      const client = await createStreamableClient(mainPort);
      try {
        const tools = await client.listTools();

        expect(
          tools.tools.find((t) => t.name === 'get-analytics'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });
  });
});
