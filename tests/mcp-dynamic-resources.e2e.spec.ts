import {
  INestApplication,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import {
  MCP_STRATEGY,
  McpController,
  McpStrategy,
  Resource,
} from '@rekog/mcp-nest';
import { bootstrapMcpApp, createStreamableClient } from './utils';

// ============================================================================
// Test Setup: Dynamic resource registration service (injects the strategy via
// the MCP_STRATEGY token, mirroring the old OnModuleInit pattern).
// ============================================================================

@Injectable()
class DynamicResourcesService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerResource({
      uri: 'mcp://dynamic-config',
      name: 'dynamic-config',
      description: 'Application configuration loaded at runtime',
      mimeType: 'application/json',
      handler: async () => {
        return {
          contents: [
            {
              uri: 'mcp://dynamic-config',
              mimeType: 'application/json',
              text: JSON.stringify({ env: 'test', version: '1.0.0' }),
            },
          ],
        };
      },
    });

    this.strategy.registerResource({
      uri: 'mcp://dynamic-status',
      name: 'dynamic-status',
      description: 'Service status',
      handler: async () => {
        return {
          contents: [
            {
              uri: 'mcp://dynamic-status',
              mimeType: 'text/plain',
              text: 'ok',
            },
          ],
        };
      },
    });
  }
}

// ============================================================================
// Test Setup: Decorator-based resource (for mixed mode testing)
// ============================================================================

@McpController()
class StaticResource {
  @Resource({
    name: 'static-resource',
    description: 'A statically defined resource using decorators',
    uri: 'mcp://static-resource',
    mimeType: 'text/plain',
  })
  getStaticResource(@Payload() { uri }: { uri: string }) {
    return {
      contents: [{ uri, mimeType: 'text/plain', text: 'static content' }],
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Dynamic Resource Registration via McpStrategy', () => {
  describe('Basic Dynamic Resources', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const { app: a, port } = await bootstrapMcpApp({
        name: 'basic-resource-server',
        controllers: [],
        providers: [DynamicResourcesService],
      });
      app = a;
      serverPort = port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list dynamically registered resources', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listResources();

        expect(
          result.resources.find((r) => r.name === 'dynamic-config'),
        ).toBeDefined();
        expect(
          result.resources.find((r) => r.name === 'dynamic-status'),
        ).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should include resource metadata in listing', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listResources();
        const configResource = result.resources.find(
          (r) => r.name === 'dynamic-config',
        );

        expect(configResource?.uri).toBe('mcp://dynamic-config');
        expect(configResource?.description).toBe(
          'Application configuration loaded at runtime',
        );
        expect(configResource?.mimeType).toBe('application/json');
      } finally {
        await client.close();
      }
    });

    it('should read a dynamically registered resource', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.readResource({
          uri: 'mcp://dynamic-config',
        });
        const content = result.contents[0] as any;

        expect(content.uri).toBe('mcp://dynamic-config');
        expect(content.mimeType).toBe('application/json');
        const parsed = JSON.parse(content.text);
        expect(parsed.env).toBe('test');
        expect(parsed.version).toBe('1.0.0');
      } finally {
        await client.close();
      }
    });

    it('should read a dynamic resource without explicit mimeType', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.readResource({
          uri: 'mcp://dynamic-status',
        });
        const content = result.contents[0] as any;

        expect(content.text).toBe('ok');
      } finally {
        await client.close();
      }
    });
  });

  describe('Mixed Mode (Decorator + Dynamic Resources)', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const { app: a, port } = await bootstrapMcpApp({
        name: 'mixed-resource-server',
        controllers: [StaticResource],
        providers: [DynamicResourcesService],
      });
      app = a;
      serverPort = port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list both decorator and dynamic resources', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listResources();

        expect(
          result.resources.find((r) => r.name === 'dynamic-config'),
        ).toBeDefined();
        expect(
          result.resources.find((r) => r.name === 'dynamic-status'),
        ).toBeDefined();
        expect(
          result.resources.find((r) => r.name === 'static-resource'),
        ).toBeDefined();
        expect(result.resources.length).toBe(3);
      } finally {
        await client.close();
      }
    });

    it('should read decorator-based resource alongside dynamic resources', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.readResource({
          uri: 'mcp://static-resource',
        });
        const content = result.contents[0] as any;

        expect(content.text).toBe('static content');
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
        name: 'multi-resource-server-1',
        controllers: [],
      });
      app1 = server1.app;
      port1 = server1.port;
      server1.strategy.registerResource({
        uri: 'mcp://server1-resource',
        name: 'server1-resource',
        description: 'Resource for server 1',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://server1-resource',
              mimeType: 'text/plain',
              text: 'server 1',
            },
          ],
        }),
      });

      const server2 = await bootstrapMcpApp({
        name: 'multi-resource-server-2',
        controllers: [],
      });
      app2 = server2.app;
      port2 = server2.port;
      server2.strategy.registerResource({
        uri: 'mcp://server2-resource',
        name: 'server2-resource',
        description: 'Resource for server 2',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://server2-resource',
              mimeType: 'text/plain',
              text: 'server 2',
            },
          ],
        }),
      });
    });

    afterAll(async () => {
      await app1.close();
      await app2.close();
    });

    it('should register dynamic resources to correct server (server 1)', async () => {
      const client = await createStreamableClient(port1);
      try {
        const result = await client.listResources();

        expect(
          result.resources.find((r) => r.name === 'server1-resource'),
        ).toBeDefined();
        expect(
          result.resources.find((r) => r.name === 'server2-resource'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should register dynamic resources to correct server (server 2)', async () => {
      const client = await createStreamableClient(port2);
      try {
        const result = await client.listResources();

        expect(
          result.resources.find((r) => r.name === 'server2-resource'),
        ).toBeDefined();
        expect(
          result.resources.find((r) => r.name === 'server1-resource'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should read resources on their respective servers', async () => {
      const client1 = await createStreamableClient(port1);
      const client2 = await createStreamableClient(port2);
      try {
        const result1 = await client1.readResource({
          uri: 'mcp://server1-resource',
        });
        expect((result1.contents[0] as any).text).toBe('server 1');

        const result2 = await client2.readResource({
          uri: 'mcp://server2-resource',
        });
        expect((result2.contents[0] as any).text).toBe('server 2');
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
        name: 'dereg-resource-server',
        controllers: [],
        providers: [DynamicResourcesService],
      });
      app = result.app;
      serverPort = result.port;
      strategy = result.strategy;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should remove a resource from the listing', async () => {
      strategy.registerResource({
        uri: 'mcp://temp-resource',
        name: 'temp-resource',
        description: 'Temporary resource',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://temp-resource',
              mimeType: 'text/plain',
              text: 'temp',
            },
          ],
        }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        let result = await client.listResources();
        expect(
          result.resources.find((r) => r.name === 'temp-resource'),
        ).toBeDefined();

        strategy.removeResource('mcp://temp-resource');

        result = await client.listResources();
        expect(
          result.resources.find((r) => r.name === 'temp-resource'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should return an error when reading a removed resource', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        await expect(
          client.readResource({ uri: 'mcp://temp-resource' }),
        ).rejects.toThrow();
      } finally {
        await client.close();
      }
    });

    it('should not affect other resources when one is removed', async () => {
      strategy.registerResource({
        uri: 'mcp://resource-to-keep',
        name: 'resource-to-keep',
        description: 'Should remain',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://resource-to-keep',
              mimeType: 'text/plain',
              text: 'kept',
            },
          ],
        }),
      });
      strategy.registerResource({
        uri: 'mcp://resource-to-remove',
        name: 'resource-to-remove',
        description: 'Should be removed',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://resource-to-remove',
              mimeType: 'text/plain',
              text: 'gone',
            },
          ],
        }),
      });

      strategy.removeResource('mcp://resource-to-remove');

      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listResources();
        expect(
          result.resources.find((r) => r.name === 'resource-to-keep'),
        ).toBeDefined();
        expect(
          result.resources.find((r) => r.name === 'resource-to-remove'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should reflect a newly registered resource on a running server', async () => {
      strategy.registerResource({
        uri: 'mcp://hot-registered-resource',
        name: 'hot-registered-resource',
        description: 'Registered after server started',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://hot-registered-resource',
              mimeType: 'text/plain',
              text: 'hot',
            },
          ],
        }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listResources();
        expect(
          result.resources.find((r) => r.name === 'hot-registered-resource'),
        ).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should re-register a resource after removal', async () => {
      strategy.registerResource({
        uri: 'mcp://reregistered-resource',
        name: 'reregistered-resource',
        description: 'Original',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://reregistered-resource',
              mimeType: 'text/plain',
              text: 'original',
            },
          ],
        }),
      });
      strategy.removeResource('mcp://reregistered-resource');
      strategy.registerResource({
        uri: 'mcp://reregistered-resource',
        name: 'reregistered-resource',
        description: 'Replacement',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://reregistered-resource',
              mimeType: 'text/plain',
              text: 'replacement',
            },
          ],
        }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listResources();
        const matches = result.resources.filter(
          (r) => r.uri === 'mcp://reregistered-resource',
        );
        expect(matches).toHaveLength(1);
        expect(matches[0].description).toBe('Replacement');

        const read = await client.readResource({
          uri: 'mcp://reregistered-resource',
        });
        expect((read.contents[0] as any).text).toBe('replacement');
      } finally {
        await client.close();
      }
    });

    it('should overwrite a resource when registered with the same uri', async () => {
      strategy.registerResource({
        uri: 'mcp://duplicate-resource',
        name: 'duplicate-resource',
        description: 'First version',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://duplicate-resource',
              mimeType: 'text/plain',
              text: 'first',
            },
          ],
        }),
      });
      strategy.registerResource({
        uri: 'mcp://duplicate-resource',
        name: 'duplicate-resource',
        description: 'Second version',
        handler: async () => ({
          contents: [
            {
              uri: 'mcp://duplicate-resource',
              mimeType: 'text/plain',
              text: 'second',
            },
          ],
        }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listResources();
        const matches = result.resources.filter(
          (r) => r.uri === 'mcp://duplicate-resource',
        );
        expect(matches).toHaveLength(1);
        expect(matches[0].description).toBe('Second version');

        const read = await client.readResource({
          uri: 'mcp://duplicate-resource',
        });
        expect((read.contents[0] as any).text).toBe('second');
      } finally {
        await client.close();
      }
    });
  });
});
