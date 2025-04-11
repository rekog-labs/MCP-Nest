import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { INestApplication, Inject, Injectable, Scope } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Context, Tool } from '../src';
import { McpModule } from '../src/mcp.module';
import { createMCPClient } from './utils';
import { REQUEST } from '@nestjs/core';

// Mock user repository
@Injectable()
class MockUserRepository {
  async findOne(id: string) {
    return Promise.resolve({
      id,
      name: 'Repository User',
      orgMemberships: [
        {
          orgId: 'org123',
          organization: {
            name: 'Repository Org',
          },
        },
      ],
    });
  }
}

// Greeting tool that uses the authentication context
@Injectable()
export class GreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that get the user by id',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ id }, context: Context) {
    const user = await this.userRepository.findOne(id);

    // Report progress for demonstration
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${user.name}!`,
        },
      ],
    };
  }

  @Tool({
    name: 'hello-world-error',
    description: 'A sample tool that get the user by id',
    parameters: z.object({}),
  })
  async sayHelloError() {
    throw new Error('any error');
  }
}

@Injectable({ scope: Scope.REQUEST })
export class GreetingToolRequestScoped {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world-scoped',
    description: 'A sample tool that get the user by id',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ id }, context: Context) {
    const user = await this.userRepository.findOne(id);

    // Report progress for demonstration
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${user.name}!`,
        },
      ],
    };
  }
}

@Injectable({ scope: Scope.REQUEST })
export class ToolRequestScoped {
  constructor(@Inject(REQUEST) private request: Request) {}

  @Tool({
    name: 'get-request-scoped',
    description: 'A sample tool that get the request',
    parameters: z.object({}),
  })
  async getRequest() {
    return {
      content: [
        {
          type: 'text',
          text: this.request.headers['any-header'] ?? 'No header found',
        },
      ],
    };
  }
}

describe('E2E: MCP ToolServer', () => {
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
      providers: [
        GreetingTool,
        GreetingToolRequestScoped,
        MockUserRepository,
        ToolRequestScoped,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list tools', async () => {
    const client = await createMCPClient(testPort);
    const tools = await client.listTools();

    // Verify that the authenticated tool is available
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.find((t) => t.name === 'hello-world')).toBeDefined();

    await client.close();
  });

  it.each([{ tool: 'hello-world' }, { tool: 'hello-world-scoped' }])(
    'should call the tool and receive progress notifications for $tool',
    async ({ tool }) => {
      const client = await createMCPClient(testPort);

      let progressCount = 1;
      const result: any = await client.callTool(
        {
          name: tool,
          arguments: { id: 'userRepo123' },
        },
        undefined,
        {
          onprogress: () => {
            progressCount++;
          },
        },
      );

      // Verify that progress notifications were received
      expect(progressCount).toBe(5);

      // Verify that authentication context was available to the tool
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Hello, Repository User!');

      await client.close();
    },
  );

  it('should call the tool and receive progress notifications for get-request-scoped', async () => {
    const client = await createMCPClient(testPort, {
      requestInit: {
        headers: {
          'any-header': 'any-value',
        },
      },
    });

    const result: any = await client.callTool({
      name: 'get-request-scoped',
      arguments: {},
    });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('any-value');

    await client.close();
  });

  it('should validate the arguments', async () => {
    const client = await createMCPClient(testPort);

    try {
      await client.callTool({
        name: 'hello-world',
        arguments: { name: 123 } as any,
      });
    } catch (error) {
      expect(error).toBeDefined();
      expect(error.message).toContain('Expected string, received number');
    }

    await client.close();
  });

  it('should call the tool and receive an error', async () => {
    const client = await createMCPClient(testPort);
    const result: any = await client.callTool({
      name: 'hello-world-error',
      arguments: {},
    });

    expect(result).toEqual({
      content: [{ type: 'text', text: 'any error' }],
      isError: true,
    });

    await client.close();
  });
});
