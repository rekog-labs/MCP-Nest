import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { McpModule } from '../src/mcp.module';
import { createSseClient } from './utils';
import { Prompt } from '../src/decorators/prompt.decorator';
import { z } from 'zod';

@Injectable()
export class GreetingPrompt {
  @Prompt({
    name: 'hello-world',
    description: 'A simple greeting prompt',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
    }),
  })
  async sayHello({ name }) {
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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-mcp-server',
          version: '0.0.1',
          guards: [],
        }),
      ],
      providers: [GreetingPrompt],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list prompts', async () => {
    const client = await createSseClient(testPort);
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
    const client = await createSseClient(testPort);

    const result: any = await client.getPrompt({
      name: 'hello-world',
      arguments: { name: 'Raphael_John' },
    });

    expect(result.description).toBe('A simple greeting prompt');
    expect(result.messages[0].content.text).toBe('Hello Raphael_John');

    await client.close();
  });

  it('should validate the arguments', async () => {
    const client = await createSseClient(testPort);

    try {
      await client.getPrompt({
        name: 'hello-world',
        arguments: { name: 123 } as any,
      });
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.message).toContain('Expected string, received number');
    }
    await client.close();
  });
});
