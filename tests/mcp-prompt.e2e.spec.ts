import { INestApplication } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { McpController, Prompt } from '@rekog/mcp-nest';
import { bootstrapMcpApp, createStreamableClient } from './utils';
import { z } from 'zod';

@McpController()
export class GreetingPrompt {
  @Prompt({
    name: 'hello-world',
    description: 'A simple greeting prompt',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
    }),
  })
  async sayHello(@Payload() { name }: { name: string }) {
    return {
      description: 'A simple greeting prompt',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Hello ${name}`,
          },
        },
      ],
    };
  }
}

describe('E2E: MCP Prompt Server', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const bootstrap = await bootstrapMcpApp({
      name: 'test-mcp-server',
      controllers: [GreetingPrompt],
    });
    app = bootstrap.app;
    testPort = bootstrap.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list prompts', async () => {
    const client = await createStreamableClient(testPort);
    const prompts = await client.listPrompts();

    expect(prompts.prompts.find((p) => p.name === 'hello-world')).toEqual({
      name: 'hello-world',
      description: 'A simple greeting prompt',
      arguments: [
        {
          name: 'name',
          description: 'The name of the person to greet',
          required: true,
        },
      ],
    });

    await client.close();
  });

  it('should call the dynamic resource', async () => {
    const client = await createStreamableClient(testPort);

    const result: any = await client.getPrompt({
      name: 'hello-world',
      arguments: { name: 'Raphael_John' },
    });

    expect(result.description).toBe('A simple greeting prompt');
    expect(result.messages[0].content.text).toBe('Hello Raphael_John');

    await client.close();
  });

  it('should validate the arguments', async () => {
    const client = await createStreamableClient(testPort);

    try {
      await client.getPrompt({
        name: 'hello-world',
        arguments: { name: 123 } as any,
      });
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.message).toContain(
        'Invalid input: expected string, received number',
      );
    }
    await client.close();
  });
});
