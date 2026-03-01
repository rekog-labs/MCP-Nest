import {
  INestApplication,
  Injectable,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { McpRegistryService } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { createStreamableClient } from './utils';
import { z } from 'zod';

/**
 * Test Suite: Dynamic capability registration from an external module
 *
 * Validates that McpRegistryService works correctly when injected into
 * a module that is separate from the module where McpModule.forRoot() lives.
 *
 * Module topology under test:
 *
 *   ServerModule  ──imports──►  McpModule.forRoot()
 *        │                      (exports McpRegistryService)
 *        │ re-exports McpRegistryService
 *        │
 *   ExternalModule ──imports──► ServerModule
 *        │                      (gets same McpRegistryService instance)
 *        │ providers register capabilities via McpRegistryService
 *        │
 *   AppModule ──imports──► ServerModule + ExternalModule
 */

// ============================================================================
// External tool registration — lives in a module separate from the MCP server
// ============================================================================

@Injectable()
class ExternalToolsService implements OnModuleInit {
  constructor(private readonly registry: McpRegistryService) {}

  onModuleInit() {
    this.registry.registerTool({
      name: 'external-tool',
      description: 'A tool registered from an external module',
      parameters: z.object({ input: z.string() }),
      handler: async (args) => ({
        content: [{ type: 'text', text: `external: ${args.input}` }],
      }),
    });

    this.registry.registerTool({
      name: 'external-tool-no-params',
      description: 'A parameterless tool from an external module',
      handler: async () => ({
        content: [{ type: 'text', text: 'no-params result' }],
      }),
    });
  }
}

// ============================================================================
// External resource registration
// ============================================================================

@Injectable()
class ExternalResourcesService implements OnModuleInit {
  constructor(private readonly registry: McpRegistryService) {}

  onModuleInit() {
    this.registry.registerResource({
      uri: 'mcp://external-config',
      name: 'external-config',
      description: 'Config resource from an external module',
      mimeType: 'application/json',
      handler: async () => ({
        contents: [
          {
            uri: 'mcp://external-config',
            mimeType: 'application/json',
            text: JSON.stringify({ source: 'external-module' }),
          },
        ],
      }),
    });
  }
}

// ============================================================================
// External prompt registration
// ============================================================================

@Injectable()
class ExternalPromptsService implements OnModuleInit {
  constructor(private readonly registry: McpRegistryService) {}

  onModuleInit() {
    this.registry.registerPrompt({
      name: 'external-prompt',
      description: 'A prompt registered from an external module',
      parameters: z.object({ topic: z.string() }),
      handler: async (args) => ({
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: `Tell me about: ${args?.topic}` },
          },
        ],
      }),
    });
  }
}

// ============================================================================
// Module structure
// ============================================================================

const serverMcpModule = McpModule.forRoot({
  name: 'external-reg-server',
  version: '1.0.0',
  mcpEndpoint: '/ext/mcp',
});

@Module({
  imports: [serverMcpModule],
  exports: [serverMcpModule],
})
class ServerModule {}

@Module({
  imports: [ServerModule],
  providers: [ExternalToolsService, ExternalResourcesService, ExternalPromptsService],
})
class ExternalModule {}

@Module({
  imports: [ServerModule, ExternalModule],
})
class AppModule {}

// ============================================================================
// Multi-server isolation variant
// ============================================================================

@Injectable()
class ServerAExternalTools implements OnModuleInit {
  constructor(private readonly registry: McpRegistryService) {}

  onModuleInit() {
    this.registry.registerTool({
      name: 'server-a-external-tool',
      description: 'Tool registered externally for server A',
      handler: async () => ({
        content: [{ type: 'text', text: 'server-a' }],
      }),
    });
  }
}

@Injectable()
class ServerBExternalTools implements OnModuleInit {
  constructor(private readonly registry: McpRegistryService) {}

  onModuleInit() {
    this.registry.registerTool({
      name: 'server-b-external-tool',
      description: 'Tool registered externally for server B',
      handler: async () => ({
        content: [{ type: 'text', text: 'server-b' }],
      }),
    });
  }
}

const mcpServerA = McpModule.forRoot({
  name: 'multi-server-a',
  version: '1.0.0',
  mcpEndpoint: '/server-a/mcp',
});

const mcpServerB = McpModule.forRoot({
  name: 'multi-server-b',
  version: '1.0.0',
  mcpEndpoint: '/server-b/mcp',
});

@Module({
  imports: [mcpServerA],
  exports: [mcpServerA],
})
class ServerAModule {}

@Module({
  imports: [mcpServerB],
  exports: [mcpServerB],
})
class ServerBModule {}

@Module({
  imports: [ServerAModule],
  providers: [ServerAExternalTools],
})
class ExternalModuleForA {}

@Module({
  imports: [ServerBModule],
  providers: [ServerBExternalTools],
})
class ExternalModuleForB {}

@Module({
  imports: [ServerAModule, ServerBModule, ExternalModuleForA, ExternalModuleForB],
})
class MultiServerAppModule {}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Dynamic registration from an external module', () => {
  jest.setTimeout(15000);

  describe('Tools, resources, and prompts registered from a separate module', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    describe('Dynamic tools', () => {
      it('should list tools registered from the external module', async () => {
        const client = await createStreamableClient(serverPort, { endpoint: '/ext/mcp' });
        try {
          const { tools } = await client.listTools();
          expect(tools.find((t) => t.name === 'external-tool')).toBeDefined();
          expect(tools.find((t) => t.name === 'external-tool-no-params')).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should execute a tool registered from the external module', async () => {
        const client = await createStreamableClient(serverPort, { endpoint: '/ext/mcp' });
        try {
          const result: any = await client.callTool({
            name: 'external-tool',
            arguments: { input: 'hello' },
          });
          expect(result.content[0].text).toBe('external: hello');
        } finally {
          await client.close();
        }
      });

      it('should execute a parameterless tool from the external module', async () => {
        const client = await createStreamableClient(serverPort, { endpoint: '/ext/mcp' });
        try {
          const result: any = await client.callTool({
            name: 'external-tool-no-params',
            arguments: {},
          });
          expect(result.content[0].text).toBe('no-params result');
        } finally {
          await client.close();
        }
      });
    });

    describe('Dynamic resources', () => {
      it('should list resources registered from the external module', async () => {
        const client = await createStreamableClient(serverPort, { endpoint: '/ext/mcp' });
        try {
          const { resources } = await client.listResources();
          expect(resources.find((r) => r.name === 'external-config')).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should read a resource registered from the external module', async () => {
        const client = await createStreamableClient(serverPort, { endpoint: '/ext/mcp' });
        try {
          const result: any = await client.readResource({ uri: 'mcp://external-config' });
          const parsed = JSON.parse(result.contents[0].text);
          expect(parsed.source).toBe('external-module');
        } finally {
          await client.close();
        }
      });
    });

    describe('Dynamic prompts', () => {
      it('should list prompts registered from the external module', async () => {
        const client = await createStreamableClient(serverPort, { endpoint: '/ext/mcp' });
        try {
          const { prompts } = await client.listPrompts();
          expect(prompts.find((p) => p.name === 'external-prompt')).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should get a prompt registered from the external module', async () => {
        const client = await createStreamableClient(serverPort, { endpoint: '/ext/mcp' });
        try {
          const result: any = await client.getPrompt({
            name: 'external-prompt',
            arguments: { topic: 'NestJS' },
          });
          expect(result.messages[0].content.text).toBe('Tell me about: NestJS');
        } finally {
          await client.close();
        }
      });
    });
  });

  describe('Multi-server isolation — external modules register to the correct server', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [MultiServerAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('server A should only have its own external tool', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/server-a/mcp' });
      try {
        const { tools } = await client.listTools();
        expect(tools.find((t) => t.name === 'server-a-external-tool')).toBeDefined();
        expect(tools.find((t) => t.name === 'server-b-external-tool')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('server B should only have its own external tool', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/server-b/mcp' });
      try {
        const { tools } = await client.listTools();
        expect(tools.find((t) => t.name === 'server-b-external-tool')).toBeDefined();
        expect(tools.find((t) => t.name === 'server-a-external-tool')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should execute tools on their respective servers', async () => {
      const clientA = await createStreamableClient(serverPort, { endpoint: '/server-a/mcp' });
      const clientB = await createStreamableClient(serverPort, { endpoint: '/server-b/mcp' });
      try {
        const resultA: any = await clientA.callTool({
          name: 'server-a-external-tool',
          arguments: {},
        });
        expect(resultA.content[0].text).toBe('server-a');

        const resultB: any = await clientB.callTool({
          name: 'server-b-external-tool',
          arguments: {},
        });
        expect(resultB.content[0].text).toBe('server-b');
      } finally {
        await clientA.close();
        await clientB.close();
      }
    });
  });
});