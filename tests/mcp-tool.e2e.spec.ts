import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { INestApplication, Inject, Injectable, Scope } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Context, McpTransportType, Tool } from '../src';
import { McpModule } from '../src/mcp.module';
import { createMCPClient, createStreamableMCPClient } from './utils';
import { REQUEST } from '@nestjs/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

@Injectable()
class MockUserRepository {
  async findByName(name: string) {
    return Promise.resolve({
      id: 'user123',
      name: 'Repository User Name ' + name,
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

@Injectable()
export class GreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that gets the user by name',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context) {
    const user = await this.userRepository.findByName(name);
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
    description: 'A sample tool that throws an error',
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
    description: 'A sample request-scoped tool that gets the user by name',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context) {
    const user = await this.userRepository.findByName(name);
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
    description: 'A sample tool that gets a header from the request',
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
          transport: McpTransportType.BOTH,
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
    if (!server.address()) {
      throw new Error('Server address not found after listen');
    }
    testPort = (server.address() as import('net').AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  const runClientTests = (
    clientType: 'http+sse' | 'streamable http',
    clientCreator: (port: number, options?: any) => Promise<Client>,
    requestScopedHeaderValue: string,
  ) => {
    describe(`using ${clientType} client (${clientCreator.name})`, () => {
      it('should list tools', async () => {
        const client = await clientCreator(testPort);
        try {
          const tools = await client.listTools();
          expect(tools.tools.length).toBeGreaterThan(0);
          expect(
            tools.tools.find((t) => t.name === 'hello-world'),
          ).toBeDefined();
          expect(
            tools.tools.find((t) => t.name === 'hello-world-scoped'),
          ).toBeDefined();
          expect(
            tools.tools.find((t) => t.name === 'get-request-scoped'),
          ).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it.each([{ tool: 'hello-world' }, { tool: 'hello-world-scoped' }])(
        'should call the tool $tool and receive results',
        async ({ tool }) => {
          const client = await clientCreator(testPort);
          try {
            let progressCount = 1;
            const result: any = await client.callTool(
              { name: tool, arguments: { name: 'userRepo123' } },
              undefined,
              {
                onprogress: (progress: Progress) => {
                  expect(progress.progress).toBeGreaterThan(0);
                  expect(progress.total).toBe(100);
                  progressCount++;
                },
              },
            );

            expect(progressCount).toBe(5);
            expect(result.content[0].type).toBe('text');
            expect(result.content[0].text).toContain(
              'Hello, Repository User Name userRepo123!',
            );
          } finally {
            await client.close();
          }
        },
      );

      it('should call the tool get-request-scoped and receive header', async () => {
        const client = await clientCreator(testPort, {
          requestInit: {
            headers: { 'any-header': requestScopedHeaderValue },
          },
        });
        try {
          const result: any = await client.callTool({
            name: 'get-request-scoped',
            arguments: {},
          });

          expect(result.content[0].type).toBe('text');
          expect(result.content[0].text).toContain(requestScopedHeaderValue);
        } finally {
          await client.close();
        }
      });

      it('should reject invalid arguments for hello-world', async () => {
        const client = await clientCreator(testPort);

        try {
          await client.callTool({
            name: 'hello-world',
            arguments: { name: 123 } as any, // Wrong type for 'name'
          });
        } catch (error) {
          expect(error).toBeDefined();
          expect(error.message).toContain('Expected string, received number');
        }

        await client.close();
      });

      it('should reject missing arguments for hello-world', async () => {
        const client = await clientCreator(testPort);

        try {
          await client.callTool({
            name: 'hello-world',
            arguments: {} as any,
          });
        } catch (error) {
          expect(error).toBeDefined();
          expect(error.message).toContain('Required');
        }

        await client.close();
      });

      it('should call the tool and receive an error', async () => {
        const client = await clientCreator(testPort);
        try {
          const result: any = await client.callTool({
            name: 'hello-world-error',
            arguments: {},
          });

          // Both clients should return the standardized error format
          expect(result).toEqual({
            content: [{ type: 'text', text: 'any error' }],
            isError: true,
          });
        } finally {
          await client.close();
        }
      });
    });
  };

  // Run tests using the HTTP+SSE MCP client
  runClientTests('http+sse', createMCPClient, 'any-value');

  // Run tests using the Streamable HTTP MCP client
  runClientTests(
    'streamable http',
    createStreamableMCPClient,
    'streamable-value',
  );
});
