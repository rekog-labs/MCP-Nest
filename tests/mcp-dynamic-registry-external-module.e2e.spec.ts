import { INestApplication, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { MCP_STRATEGY, McpStrategy } from '@rekog/mcp-nest';
import { bootstrapMcpApp, createStreamableClient } from './utils';
import { z } from 'zod';

/**
 * Test Suite: Dynamic capability registration from external provider services
 *
 * Validates that dynamic registration via the McpStrategy works correctly when
 * the registering services are decoupled from the capability controllers and
 * obtain the strategy purely through the `MCP_STRATEGY` DI token (mirroring the
 * old "register from a separate module" pattern).
 *
 * The strategy is created and connected by `bootstrapMcpApp` and exposed under
 * the `MCP_STRATEGY` DI token. Any provider can inject the same strategy
 * instance and register capabilities in a lifecycle hook.
 */

// ============================================================================
// External tool registration — lives in a module separate from the MCP server
// ============================================================================

@Injectable()
class ExternalToolsService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'external-tool',
      description: 'A tool registered from an external module',
      parameters: z.object({ input: z.string() }),
      handler: async (args) => ({
        content: [{ type: 'text', text: `external: ${args.input}` }],
      }),
    });

    this.strategy.registerTool({
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
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerResource({
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
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerPrompt({
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
// Multi-server isolation variant
// ============================================================================

@Injectable()
class ServerAExternalTools implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
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
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'server-b-external-tool',
      description: 'Tool registered externally for server B',
      handler: async () => ({
        content: [{ type: 'text', text: 'server-b' }],
      }),
    });
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Dynamic registration from an external module', () => {
  describe('Tools, resources, and prompts registered from a separate module', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const { app: a, port } = await bootstrapMcpApp({
        name: 'external-reg-server',
        controllers: [],
        providers: [
          ExternalToolsService,
          ExternalResourcesService,
          ExternalPromptsService,
        ],
      });
      app = a;
      serverPort = port;
    });

    afterAll(async () => {
      await app.close();
    });

    describe('Dynamic tools', () => {
      it('should list tools registered from the external module', async () => {
        const client = await createStreamableClient(serverPort);
        try {
          const { tools } = await client.listTools();
          expect(tools.find((t) => t.name === 'external-tool')).toBeDefined();
          expect(
            tools.find((t) => t.name === 'external-tool-no-params'),
          ).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should execute a tool registered from the external module', async () => {
        const client = await createStreamableClient(serverPort);
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
        const client = await createStreamableClient(serverPort);
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
        const client = await createStreamableClient(serverPort);
        try {
          const { resources } = await client.listResources();
          expect(
            resources.find((r) => r.name === 'external-config'),
          ).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should read a resource registered from the external module', async () => {
        const client = await createStreamableClient(serverPort);
        try {
          const result: any = await client.readResource({
            uri: 'mcp://external-config',
          });
          const parsed = JSON.parse(result.contents[0].text);
          expect(parsed.source).toBe('external-module');
        } finally {
          await client.close();
        }
      });
    });

    describe('Dynamic prompts', () => {
      it('should list prompts registered from the external module', async () => {
        const client = await createStreamableClient(serverPort);
        try {
          const { prompts } = await client.listPrompts();
          expect(
            prompts.find((p) => p.name === 'external-prompt'),
          ).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should get a prompt registered from the external module', async () => {
        const client = await createStreamableClient(serverPort);
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
    let appA: INestApplication;
    let appB: INestApplication;
    let portA: number;
    let portB: number;

    beforeAll(async () => {
      const serverA = await bootstrapMcpApp({
        name: 'multi-server-a',
        controllers: [],
        providers: [ServerAExternalTools],
      });
      appA = serverA.app;
      portA = serverA.port;

      const serverB = await bootstrapMcpApp({
        name: 'multi-server-b',
        controllers: [],
        providers: [ServerBExternalTools],
      });
      appB = serverB.app;
      portB = serverB.port;
    });

    afterAll(async () => {
      await appA.close();
      await appB.close();
    });

    it('server A should only have its own external tool', async () => {
      const client = await createStreamableClient(portA);
      try {
        const { tools } = await client.listTools();
        expect(
          tools.find((t) => t.name === 'server-a-external-tool'),
        ).toBeDefined();
        expect(
          tools.find((t) => t.name === 'server-b-external-tool'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('server B should only have its own external tool', async () => {
      const client = await createStreamableClient(portB);
      try {
        const { tools } = await client.listTools();
        expect(
          tools.find((t) => t.name === 'server-b-external-tool'),
        ).toBeDefined();
        expect(
          tools.find((t) => t.name === 'server-a-external-tool'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should execute tools on their respective servers', async () => {
      const clientA = await createStreamableClient(portA);
      const clientB = await createStreamableClient(portB);
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
