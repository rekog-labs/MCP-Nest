import {
  INestApplication,
  Injectable,
  Module,
  OnModuleInit,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prompt, McpDynamicCapabilityRegistryService } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { createStreamableClient } from './utils';
import { z } from 'zod';

// ============================================================================
// Test Setup: Dynamic prompt registration service
// ============================================================================

@Injectable()
class DynamicPromptsService implements OnModuleInit {
  constructor(private readonly capabilityBuilder: McpDynamicCapabilityRegistryService) {}

  onModuleInit() {
    this.capabilityBuilder.registerPrompt({
      name: 'summarize',
      description: 'Summarize the provided text',
      parameters: z.object({
        text: z.string().describe('The text to summarize'),
        style: z.enum(['brief', 'detailed']).optional().describe('Summary style'),
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

    this.capabilityBuilder.registerPrompt({
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

@Injectable()
class StaticPrompt {
  @Prompt({
    name: 'static-prompt',
    description: 'A statically defined prompt using decorators',
    parameters: z.object({
      topic: z.string().describe('The topic to write about'),
    }),
  })
  getStaticPrompt({ topic }: { topic: string }) {
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
// Test Setup: Multi-server isolation
// ============================================================================

@Injectable()
class Server1DynamicPrompts implements OnModuleInit {
  constructor(private readonly capabilityBuilder: McpDynamicCapabilityRegistryService) {}

  onModuleInit() {
    this.capabilityBuilder.registerPrompt({
      name: 'server1-prompt',
      description: 'Prompt for server 1',
      handler: async () => ({
        description: 'Prompt for server 1',
        messages: [{ role: 'user', content: { type: 'text', text: 'server 1 prompt' } }],
      }),
    });
  }
}

@Injectable()
class Server2DynamicPrompts implements OnModuleInit {
  constructor(private readonly capabilityBuilder: McpDynamicCapabilityRegistryService) {}

  onModuleInit() {
    this.capabilityBuilder.registerPrompt({
      name: 'server2-prompt',
      description: 'Prompt for server 2',
      handler: async () => ({
        description: 'Prompt for server 2',
        messages: [{ role: 'user', content: { type: 'text', text: 'server 2 prompt' } }],
      }),
    });
  }
}

// ============================================================================
// Modules
// ============================================================================

const deregServerModule = McpModule.forRoot({
  name: 'dereg-prompt-server',
  version: '1.0.0',
  mcpEndpoint: '/dereg/mcp',
});

@Module({
  imports: [deregServerModule],
  providers: [DynamicPromptsService],
})
class DeregistrationPromptsAppModule {}

const basicServerModule = McpModule.forRoot({
  name: 'basic-prompt-server',
  version: '1.0.0',
  mcpEndpoint: '/basic/mcp',
});

@Module({
  imports: [basicServerModule],
  providers: [DynamicPromptsService],
})
class BasicDynamicPromptsAppModule {}

const mixedServerModule = McpModule.forRoot({
  name: 'mixed-prompt-server',
  version: '1.0.0',
  mcpEndpoint: '/mixed/mcp',
});

@Module({
  imports: [mixedServerModule],
  providers: [DynamicPromptsService, StaticPrompt],
})
class MixedPromptsAppModule {}

const multiServer1Module = McpModule.forRoot({
  name: 'multi-prompt-server-1',
  version: '1.0.0',
  mcpEndpoint: '/multi1/mcp',
});

const multiServer2Module = McpModule.forRoot({
  name: 'multi-prompt-server-2',
  version: '1.0.0',
  mcpEndpoint: '/multi2/mcp',
});

@Module({ imports: [multiServer1Module], providers: [Server1DynamicPrompts] })
class MultiPromptServer1Module {}

@Module({ imports: [multiServer2Module], providers: [Server2DynamicPrompts] })
class MultiPromptServer2Module {}

@Module({ imports: [MultiPromptServer1Module, MultiPromptServer2Module] })
class MultiPromptServerAppModule {}

// ============================================================================
// Tests
// ============================================================================

describe('E2E: Dynamic Prompt Registration via McpDynamicCapabilityRegistryService', () => {
  jest.setTimeout(15000);

  describe('Basic Dynamic Prompts', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [BasicDynamicPromptsAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list dynamically registered prompts', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/basic/mcp' });
      try {
        const result = await client.listPrompts();

        expect(result.prompts.find((p) => p.name === 'summarize')).toBeDefined();
        expect(result.prompts.find((p) => p.name === 'translate')).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should include argument metadata for prompts with parameters', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/basic/mcp' });
      try {
        const result = await client.listPrompts();
        const summarize = result.prompts.find((p) => p.name === 'summarize');

        expect(summarize?.description).toBe('Summarize the provided text');
        expect(summarize?.arguments?.find((a) => a.name === 'text')).toMatchObject({
          name: 'text',
          required: true,
        });
        expect(summarize?.arguments?.find((a) => a.name === 'style')).toMatchObject({
          name: 'style',
          required: false,
        });
      } finally {
        await client.close();
      }
    });

    it('should execute a dynamically registered prompt with arguments', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/basic/mcp' });
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
      const client = await createStreamableClient(serverPort, { endpoint: '/basic/mcp' });
      try {
        const result: any = await client.getPrompt({ name: 'translate', arguments: {} });

        expect(result.messages[0].content.text).toBe('Please translate the text.');
      } finally {
        await client.close();
      }
    });
  });

  describe('Mixed Mode (Decorator + Dynamic Prompts)', () => {
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [MixedPromptsAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should list both decorator and dynamic prompts', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/mixed/mcp' });
      try {
        const result = await client.listPrompts();

        expect(result.prompts.find((p) => p.name === 'summarize')).toBeDefined();
        expect(result.prompts.find((p) => p.name === 'translate')).toBeDefined();
        expect(result.prompts.find((p) => p.name === 'static-prompt')).toBeDefined();
        expect(result.prompts.length).toBe(3);
      } finally {
        await client.close();
      }
    });

    it('should execute decorator-based prompt alongside dynamic prompts', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/mixed/mcp' });
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
    let app: INestApplication;
    let serverPort: number;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [MultiPromptServerAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should register dynamic prompts to correct server (server 1)', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/multi1/mcp' });
      try {
        const result = await client.listPrompts();

        expect(result.prompts.find((p) => p.name === 'server1-prompt')).toBeDefined();
        expect(result.prompts.find((p) => p.name === 'server2-prompt')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should register dynamic prompts to correct server (server 2)', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/multi2/mcp' });
      try {
        const result = await client.listPrompts();

        expect(result.prompts.find((p) => p.name === 'server2-prompt')).toBeDefined();
        expect(result.prompts.find((p) => p.name === 'server1-prompt')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should execute prompts on their respective servers', async () => {
      const client1 = await createStreamableClient(serverPort, { endpoint: '/multi1/mcp' });
      const client2 = await createStreamableClient(serverPort, { endpoint: '/multi2/mcp' });
      try {
        const result1: any = await client1.getPrompt({ name: 'server1-prompt', arguments: {} });
        expect(result1.messages[0].content.text).toBe('server 1 prompt');

        const result2: any = await client2.getPrompt({ name: 'server2-prompt', arguments: {} });
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
    let capabilityBuilder: McpDynamicCapabilityRegistryService;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [DeregistrationPromptsAppModule],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      serverPort = (app.getHttpServer().address() as import('net').AddressInfo).port;
      capabilityBuilder = moduleFixture.get(McpDynamicCapabilityRegistryService, { strict: false });
    });

    afterAll(async () => {
      await app.close();
    });

    it('should remove a prompt from the listing', async () => {
      capabilityBuilder.registerPrompt({
        name: 'temp-prompt',
        description: 'Temporary prompt',
        handler: async () => ({
          description: 'Temporary prompt',
          messages: [{ role: 'user', content: { type: 'text', text: 'temp' } }],
        }),
      });

      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        let result = await client.listPrompts();
        expect(result.prompts.find((p) => p.name === 'temp-prompt')).toBeDefined();

        capabilityBuilder.removePrompt('temp-prompt');

        result = await client.listPrompts();
        expect(result.prompts.find((p) => p.name === 'temp-prompt')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should return an error when getting a removed prompt', async () => {
      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        await expect(
          client.getPrompt({ name: 'temp-prompt', arguments: {} }),
        ).rejects.toThrow();
      } finally {
        await client.close();
      }
    });

    it('should not affect other prompts when one is removed', async () => {
      capabilityBuilder.registerPrompt({
        name: 'prompt-to-keep',
        description: 'Should remain',
        handler: async () => ({
          description: 'Should remain',
          messages: [{ role: 'user', content: { type: 'text', text: 'kept' } }],
        }),
      });
      capabilityBuilder.registerPrompt({
        name: 'prompt-to-remove',
        description: 'Should be removed',
        handler: async () => ({
          description: 'Should be removed',
          messages: [{ role: 'user', content: { type: 'text', text: 'gone' } }],
        }),
      });

      capabilityBuilder.removePrompt('prompt-to-remove');

      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        const result = await client.listPrompts();
        expect(result.prompts.find((p) => p.name === 'prompt-to-keep')).toBeDefined();
        expect(result.prompts.find((p) => p.name === 'prompt-to-remove')).toBeUndefined();
      } finally {
        await client.close();
      }
    });

    it('should reflect a newly registered prompt on a running server', async () => {
      capabilityBuilder.registerPrompt({
        name: 'hot-registered-prompt',
        description: 'Registered after server started',
        handler: async () => ({
          description: 'Registered after server started',
          messages: [{ role: 'user', content: { type: 'text', text: 'hot' } }],
        }),
      });

      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        const result = await client.listPrompts();
        expect(result.prompts.find((p) => p.name === 'hot-registered-prompt')).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it('should re-register a prompt after removal', async () => {
      capabilityBuilder.registerPrompt({
        name: 'reregistered-prompt',
        description: 'Original',
        handler: async () => ({
          description: 'Original',
          messages: [{ role: 'user', content: { type: 'text', text: 'original' } }],
        }),
      });
      capabilityBuilder.removePrompt('reregistered-prompt');
      capabilityBuilder.registerPrompt({
        name: 'reregistered-prompt',
        description: 'Replacement',
        handler: async () => ({
          description: 'Replacement',
          messages: [{ role: 'user', content: { type: 'text', text: 'replacement' } }],
        }),
      });

      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        const result = await client.listPrompts();
        const matches = result.prompts.filter((p) => p.name === 'reregistered-prompt');
        expect(matches).toHaveLength(1);
        expect(matches[0].description).toBe('Replacement');

        const got: any = await client.getPrompt({ name: 'reregistered-prompt', arguments: {} });
        expect(got.messages[0].content.text).toBe('replacement');
      } finally {
        await client.close();
      }
    });

    it('should overwrite a prompt when registered with the same name', async () => {
      capabilityBuilder.registerPrompt({
        name: 'duplicate-prompt',
        description: 'First version',
        handler: async () => ({
          description: 'First version',
          messages: [{ role: 'user', content: { type: 'text', text: 'first' } }],
        }),
      });
      capabilityBuilder.registerPrompt({
        name: 'duplicate-prompt',
        description: 'Second version',
        handler: async () => ({
          description: 'Second version',
          messages: [{ role: 'user', content: { type: 'text', text: 'second' } }],
        }),
      });

      const client = await createStreamableClient(serverPort, { endpoint: '/dereg/mcp' });
      try {
        const result = await client.listPrompts();
        const matches = result.prompts.filter((p) => p.name === 'duplicate-prompt');
        expect(matches).toHaveLength(1);
        expect(matches[0].description).toBe('Second version');

        const got: any = await client.getPrompt({ name: 'duplicate-prompt', arguments: {} });
        expect(got.messages[0].content.text).toBe('second');
      } finally {
        await client.close();
      }
    });
  });
});