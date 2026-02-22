import {
  INestApplication,
  Injectable,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Resource, McpCapabilityBuilder } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { createStreamableClient } from './utils';

// ============================================================================
// Test Setup: Dynamic resource registration service
// ============================================================================

@Injectable()
class DynamicResourcesService implements OnModuleInit {
  constructor(private readonly capabilityBuilder: McpCapabilityBuilder) {}

  onModuleInit() {
    this.capabilityBuilder.registerResource({
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

    this.capabilityBuilder.registerResource({
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

@Injectable()
class StaticResource {
  @Resource({
    name: 'static-resource',
    description: 'A statically defined resource using decorators',
    uri: 'mcp://static-resource',
    mimeType: 'text/plain',
  })
  getStaticResource({ uri }: { uri: string }) {
    return {
      contents: [{ uri, mimeType: 'text/plain', text: 'static content' }],
    };
  }
}

// ============================================================================
// Test Setup: Multi-server isolation
// ============================================================================

@Injectable()
class Server1DynamicResources implements OnModuleInit {
  constructor(private readonly capabilityBuilder: McpCapabilityBuilder) {}

  onModuleInit() {
    this.capabilityBuilder.registerResource({
      uri: 'mcp://server1-resource',
      name: 'server1-resource',
      description: 'Resource for server 1',
      handler: async () => ({
        contents: [{ uri: 'mcp://server1-resource', mimeType: 'text/plain', text: 'server 1' }],
      }),
    });
  }
}

@Injectable()
class Server2DynamicResources implements OnModuleInit {
  constructor(private readonly capabilityBuilder: McpCapabilityBuilder) {}

  onModuleInit() {
    this.capabilityBuilder.registerResource({
      uri: 'mcp://server2-resource',
      name: 'server2-resource',
      description: 'Resource for server 2',
      handler: async () => ({
        contents: [{ uri: 'mcp://server2-resource', mimeType: 'text/plain', text: 'server 2' }],
      }),
    });
  }
}

// ============================================================================
// Modules
// ============================================================================

const basicServerModule = McpModule.forRoot({
  name: 'basic-resource-server',
  version: '1.0.0',
  mcpEndpoint: '/basic/mcp',
});

@Module({
  imports: [basicServerModule],
  providers: [DynamicResourcesService],
})
class BasicDynamicResourcesAppModule {}

const mixedServerModule = McpModule.forRoot({
  name: 'mixed-resource-server',
  version: '1.0.0',
  mcpEndpoint: '/mixed/mcp',
});

@Module({
  imports: [mixedServerModule],
  providers: [DynamicResourcesService, StaticResource],
})
class MixedResourcesAppModule {}

const multiServer1Module = McpModule.forRoot({
  name: 'multi-resource-server-1',
  version: '1.0.0',
  mcpEndpoint: '/multi1/mcp',
});

const multiServer2Module = McpModule.forRoot({
  name: 'multi-resource-server-2',
  version: '1.0.0',
  mcpEndpoint: '/multi2/mcp',
});

@Module({ imports: [multiServer1Module], providers: [Server1DynamicResources] })
class MultiResourceServer1Module {}

@Module({ imports: [multiServer2Module], providers: [Server2DynamicResources] })
class MultiResourceServer2Module {}

@Module({ imports: [MultiResourceServer1Module, MultiResourceServer2Module] })
class MultiResourceServerAppModule {}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Dynamic Resource Registration via McpCapabilityBuilder', () => {
  jest.setTimeout(15000);

  describe('Basic Dynamic Resources', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [BasicDynamicResourcesAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list dynamically registered resources', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/basic/mcp' });
      try {
        const result = await client.listResources();

        expect(result.resources.find((r) => r.name === 'dynamic-config')).toBeDefined();
        expect(result.resources.find((r) => r.name === 'dynamic-status')).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should include resource metadata in listing', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/basic/mcp' });
      try {
        const result = await client.listResources();
        const configResource = result.resources.find((r) => r.name === 'dynamic-config');

        expect(configResource?.uri).toBe('mcp://dynamic-config');
        expect(configResource?.description).toBe('Application configuration loaded at runtime');
        expect(configResource?.mimeType).toBe('application/json');
      } finally {
        await client.close();
      }
    });

    it('should read a dynamically registered resource', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/basic/mcp' });
      try {
        const result = await client.readResource({ uri: 'mcp://dynamic-config' });
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
      const client = await createStreamableClient(serverPort, { endpoint: '/basic/mcp' });
      try {
        const result = await client.readResource({ uri: 'mcp://dynamic-status' });
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
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [MixedResourcesAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list both decorator and dynamic resources', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/mixed/mcp' });
      try {
        const result = await client.listResources();

        expect(result.resources.find((r) => r.name === 'dynamic-config')).toBeDefined();
        expect(result.resources.find((r) => r.name === 'dynamic-status')).toBeDefined();
        expect(result.resources.find((r) => r.name === 'static-resource')).toBeDefined();
        expect(result.resources.length).toBe(3);
      } finally {
        await client.close();
      }
    });

    it('should read decorator-based resource alongside dynamic resources', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/mixed/mcp' });
      try {
        const result = await client.readResource({ uri: 'mcp://static-resource' });
        const content = result.contents[0] as any;

        expect(content.text).toBe('static content');
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
        imports: [MultiResourceServerAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should register dynamic resources to correct server (server 1)', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/multi1/mcp' });
      try {
        const result = await client.listResources();

        expect(result.resources.find((r) => r.name === 'server1-resource')).toBeDefined();
        expect(result.resources.find((r) => r.name === 'server2-resource')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should register dynamic resources to correct server (server 2)', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/multi2/mcp' });
      try {
        const result = await client.listResources();

        expect(result.resources.find((r) => r.name === 'server2-resource')).toBeDefined();
        expect(result.resources.find((r) => r.name === 'server1-resource')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should read resources on their respective servers', async () => {
      const client1 = await createStreamableClient(serverPort, { endpoint: '/multi1/mcp' });
      const client2 = await createStreamableClient(serverPort, { endpoint: '/multi2/mcp' });
      try {
        const result1 = await client1.readResource({ uri: 'mcp://server1-resource' });
        expect((result1.contents[0] as any).text).toBe('server 1');

        const result2 = await client2.readResource({ uri: 'mcp://server2-resource' });
        expect((result2.contents[0] as any).text).toBe('server 2');
      } finally {
        await client1.close();
        await client2.close();
      }
    });
  });
});