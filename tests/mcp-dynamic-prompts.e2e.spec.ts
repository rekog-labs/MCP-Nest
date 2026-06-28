import { INestApplication, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { MCP_STRATEGY, McpController, McpStrategy, Prompt } from '@rekog/mcp-nest';
import { bootstrapMcpApp, createStreamableClient } from './utils';
import { z } from 'zod';

// ============================================================================
// Test Setup: Dynamic prompt registration service (injects the strategy via
// the MCP_STRATEGY token, mirroring the old OnModuleInit pattern).
// ============================================================================

@Injectable()
class DynamicPromptsService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerPrompt({
      name: 'summarize',
      description: 'Summarize the provided text',
      parameters: z.object({
        text: z.string().describe('The text to summarize'),
        style: z
          .enum(['brief', 'detailed'])
          .optional()
          .describe('Summary style'),
      }),
      handler: async (args) => {
        return {
          description: 'Summarize the provided text',
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please summarize the following in ${args?.style ?? 'brief'} style:\n\n${args?.text}`,
              },
            },
          ],
        };
      },
    });

    this.strategy.registerPrompt({
      name: 'translate',
      description: 'Translate text to another language',
      handler: async () => {
        return {
          description: 'Translate text to another language',
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: 'Please translate the text.' },
            },
          ],
        };
      },
    });
  }
}

// ============================================================================
// Test Setup: Decorator-based prompt (for mixed mode testing)
// ============================================================================

@McpController()
class StaticPrompt {
  @Prompt({
    name: 'static-prompt',
    description: 'A statically defined prompt using decorators',
    parameters: z.object({
      topic: z.string().describe('The topic to write about'),
    }),
  })
  getStaticPrompt(@Payload() { topic }: { topic: string }) {
    return {
      description: 'A statically defined prompt using decorators',
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Write about: ${topic}` },
        },
      ],
    };
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Dynamic Prompt Registration via McpStrategy', () => {
  describe('Basic Dynamic Prompts', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const { app: a, port } = await bootstrapMcpApp({
        name: 'basic-prompt-server',
        controllers: [],
        providers: [DynamicPromptsService],
      });
      app = a;
      serverPort = port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list dynamically registered prompts', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listPrompts();

        expect(
          result.prompts.find((p) => p.name === 'summarize'),
        ).toBeDefined();
        expect(
          result.prompts.find((p) => p.name === 'translate'),
        ).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should include argument metadata for prompts with parameters', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listPrompts();
        const summarize = result.prompts.find((p) => p.name === 'summarize');

        expect(summarize?.description).toBe('Summarize the provided text');
        expect(
          summarize?.arguments?.find((a) => a.name === 'text'),
        ).toMatchObject({
          name: 'text',
          required: true,
        });
        expect(
          summarize?.arguments?.find((a) => a.name === 'style'),
        ).toMatchObject({
          name: 'style',
          required: false,
        });
      } finally {
        await client.close();
      }
    });

    it('should execute a dynamically registered prompt with arguments', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result: any = await client.getPrompt({
          name: 'summarize',
          arguments: { text: 'Hello world', style: 'brief' },
        });

        expect(result.messages[0].content.text).toContain('Hello world');
        expect(result.messages[0].content.text).toContain('brief');
      } finally {
        await client.close();
      }
    });

    it('should execute a dynamic prompt without parameters', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result: any = await client.getPrompt({
          name: 'translate',
          arguments: {},
        });

        expect(result.messages[0].content.text).toBe(
          'Please translate the text.',
        );
      } finally {
        await client.close();
      }
    });
  });

  describe('Mixed Mode (Decorator + Dynamic Prompts)', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const { app: a, port } = await bootstrapMcpApp({
        name: 'mixed-prompt-server',
        controllers: [StaticPrompt],
        providers: [DynamicPromptsService],
      });
      app = a;
      serverPort = port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list both decorator and dynamic prompts', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listPrompts();

        expect(
          result.prompts.find((p) => p.name === 'summarize'),
        ).toBeDefined();
        expect(
          result.prompts.find((p) => p.name === 'translate'),
        ).toBeDefined();
        expect(
          result.prompts.find((p) => p.name === 'static-prompt'),
        ).toBeDefined();
        expect(result.prompts.length).toBe(3);
      } finally {
        await client.close();
      }
    });

    it('should execute decorator-based prompt alongside dynamic prompts', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        const result: any = await client.getPrompt({
          name: 'static-prompt',
          arguments: { topic: 'testing' },
        });

        expect(result.messages[0].content.text).toBe('Write about: testing');
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
        name: 'multi-prompt-server-1',
        controllers: [],
      });
      app1 = server1.app;
      port1 = server1.port;
      server1.strategy.registerPrompt({
        name: 'server1-prompt',
        description: 'Prompt for server 1',
        handler: async () => ({
          description: 'Prompt for server 1',
          messages: [
            { role: 'user', content: { type: 'text', text: 'server 1 prompt' } },
          ],
        }),
      });

      const server2 = await bootstrapMcpApp({
        name: 'multi-prompt-server-2',
        controllers: [],
      });
      app2 = server2.app;
      port2 = server2.port;
      server2.strategy.registerPrompt({
        name: 'server2-prompt',
        description: 'Prompt for server 2',
        handler: async () => ({
          description: 'Prompt for server 2',
          messages: [
            { role: 'user', content: { type: 'text', text: 'server 2 prompt' } },
          ],
        }),
      });
    });

    afterAll(async () => {
      await app1.close();
      await app2.close();
    });

    it('should register dynamic prompts to correct server (server 1)', async () => {
      const client = await createStreamableClient(port1);
      try {
        const result = await client.listPrompts();

        expect(
          result.prompts.find((p) => p.name === 'server1-prompt'),
        ).toBeDefined();
        expect(
          result.prompts.find((p) => p.name === 'server2-prompt'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should register dynamic prompts to correct server (server 2)', async () => {
      const client = await createStreamableClient(port2);
      try {
        const result = await client.listPrompts();

        expect(
          result.prompts.find((p) => p.name === 'server2-prompt'),
        ).toBeDefined();
        expect(
          result.prompts.find((p) => p.name === 'server1-prompt'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should execute prompts on their respective servers', async () => {
      const client1 = await createStreamableClient(port1);
      const client2 = await createStreamableClient(port2);
      try {
        const result1: any = await client1.getPrompt({
          name: 'server1-prompt',
          arguments: {},
        });
        expect(result1.messages[0].content.text).toBe('server 1 prompt');

        const result2: any = await client2.getPrompt({
          name: 'server2-prompt',
          arguments: {},
        });
        expect(result2.messages[0].content.text).toBe('server 2 prompt');
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
        name: 'dereg-prompt-server',
        controllers: [],
        providers: [DynamicPromptsService],
      });
      app = result.app;
      serverPort = result.port;
      strategy = result.strategy;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should remove a prompt from the listing', async () => {
      strategy.registerPrompt({
        name: 'temp-prompt',
        description: 'Temporary prompt',
        handler: async () => ({
          description: 'Temporary prompt',
          messages: [{ role: 'user', content: { type: 'text', text: 'temp' } }],
        }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        let result = await client.listPrompts();
        expect(
          result.prompts.find((p) => p.name === 'temp-prompt'),
        ).toBeDefined();

        strategy.removePrompt('temp-prompt');

        result = await client.listPrompts();
        expect(
          result.prompts.find((p) => p.name === 'temp-prompt'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should return an error when getting a removed prompt', async () => {
      const client = await createStreamableClient(serverPort);
      try {
        await expect(
          client.getPrompt({ name: 'temp-prompt', arguments: {} }),
        ).rejects.toThrow();
      } finally {
        await client.close();
      }
    });

    it('should not affect other prompts when one is removed', async () => {
      strategy.registerPrompt({
        name: 'prompt-to-keep',
        description: 'Should remain',
        handler: async () => ({
          description: 'Should remain',
          messages: [{ role: 'user', content: { type: 'text', text: 'kept' } }],
        }),
      });
      strategy.registerPrompt({
        name: 'prompt-to-remove',
        description: 'Should be removed',
        handler: async () => ({
          description: 'Should be removed',
          messages: [{ role: 'user', content: { type: 'text', text: 'gone' } }],
        }),
      });

      strategy.removePrompt('prompt-to-remove');

      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listPrompts();
        expect(
          result.prompts.find((p) => p.name === 'prompt-to-keep'),
        ).toBeDefined();
        expect(
          result.prompts.find((p) => p.name === 'prompt-to-remove'),
        ).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should reflect a newly registered prompt on a running server', async () => {
      strategy.registerPrompt({
        name: 'hot-registered-prompt',
        description: 'Registered after server started',
        handler: async () => ({
          description: 'Registered after server started',
          messages: [{ role: 'user', content: { type: 'text', text: 'hot' } }],
        }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listPrompts();
        expect(
          result.prompts.find((p) => p.name === 'hot-registered-prompt'),
        ).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should re-register a prompt after removal', async () => {
      strategy.registerPrompt({
        name: 'reregistered-prompt',
        description: 'Original',
        handler: async () => ({
          description: 'Original',
          messages: [
            { role: 'user', content: { type: 'text', text: 'original' } },
          ],
        }),
      });
      strategy.removePrompt('reregistered-prompt');
      strategy.registerPrompt({
        name: 'reregistered-prompt',
        description: 'Replacement',
        handler: async () => ({
          description: 'Replacement',
          messages: [
            { role: 'user', content: { type: 'text', text: 'replacement' } },
          ],
        }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listPrompts();
        const matches = result.prompts.filter(
          (p) => p.name === 'reregistered-prompt',
        );
        expect(matches).toHaveLength(1);
        expect(matches[0].description).toBe('Replacement');

        const got: any = await client.getPrompt({
          name: 'reregistered-prompt',
          arguments: {},
        });
        expect(got.messages[0].content.text).toBe('replacement');
      } finally {
        await client.close();
      }
    });

    it('should overwrite a prompt when registered with the same name', async () => {
      strategy.registerPrompt({
        name: 'duplicate-prompt',
        description: 'First version',
        handler: async () => ({
          description: 'First version',
          messages: [
            { role: 'user', content: { type: 'text', text: 'first' } },
          ],
        }),
      });
      strategy.registerPrompt({
        name: 'duplicate-prompt',
        description: 'Second version',
        handler: async () => ({
          description: 'Second version',
          messages: [
            { role: 'user', content: { type: 'text', text: 'second' } },
          ],
        }),
      });

      const client = await createStreamableClient(serverPort);
      try {
        const result = await client.listPrompts();
        const matches = result.prompts.filter(
          (p) => p.name === 'duplicate-prompt',
        );
        expect(matches).toHaveLength(1);
        expect(matches[0].description).toBe('Second version');

        const got: any = await client.getPrompt({
          name: 'duplicate-prompt',
          arguments: {},
        });
        expect(got.messages[0].content.text).toBe('second');
      } finally {
        await client.close();
      }
    });
  });
});
