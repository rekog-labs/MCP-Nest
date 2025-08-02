import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { INestApplication, Inject, Injectable, Scope } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Context, McpTransportType, Tool } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import {
  createSseClient,
  createStdioClient,
  createStreamableClient,
  createSseClientWithElicitation,
  createStreamableClientWithElicitation,
} from './utils';
import { REQUEST } from '@nestjs/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { randomUUID } from 'crypto';

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
    // Validate that mcpServer and mcpRequest properties exist
    if (!context.mcpServer) {
      throw new Error('mcpServer is not defined in the context');
    }
    if (!context.mcpRequest) {
      throw new Error('mcpRequest is not defined in the context');
    }

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

  @Tool({
    name: 'hello-world-with-annotations',
    description: 'A sample tool with annotations',
    parameters: z.object({
      name: z.string().default('World'),
    }),
    annotations: {
      title: 'Say Hello',
      readOnlyHint: true,
      openWorldHint: false,
    },
  })
  async sayHelloWithAnnotations({ name }, context: Context) {
    const user = await this.userRepository.findByName(name);
    return {
      content: [
        {
          type: 'text',
          text: `Hello with annotations, ${user.name}!`,
        },
      ],
    };
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

@Injectable()
class OutputSchemaTool {
  constructor() {}
  @Tool({
    name: 'output-schema-tool',
    description: 'A tool to test outputSchema',
    parameters: z.object({
      input: z.string().describe('Example input'),
    }),
    outputSchema: z.object({
      result: z.string().describe('Example result'),
    }),
  })
  async execute({ input }) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ result: input }),
        },
      ],
    };
  }
}

@Injectable()
class InvalidOutputSchemaTool {
  @Tool({
    name: 'invalid-output-schema-tool',
    description: 'Returns an object that does not match its outputSchema',
    parameters: z.object({}),
    outputSchema: z.object({
      foo: z.string(),
    }),
  })
  async execute() {
    return { bar: 123 };
  }
}

@Injectable()
class ValidationTestTool {
  @Tool({
    name: 'validation-test-tool',
    description: 'A tool to test input validation with required parameters',
    parameters: z.object({
      requiredString: z.string(),
      requiredNumber: z.number(),
      optionalParam: z.string().optional(),
    }),
  })
  async execute({ requiredString, requiredNumber, optionalParam }) {
    return {
      content: [
        {
          type: 'text',
          text: `Received: ${requiredString}, ${requiredNumber}, ${optionalParam}`,
        },
      ],
    };
  }
}

@Injectable()
class NotMcpCompliantGreetingTool {
  @Tool({
    name: 'not-mcp-greeting',
    description: 'Returns a plain object, not MCP-compliant',
    parameters: z.object({ name: z.string().default('World') }),
  })
  async greet({ name }) {
    return { greeting: `Hello, ${name}!` };
  }
}

@Injectable()
class NotMcpCompliantStructuredGreetingTool {
  @Tool({
    name: 'not-mcp-structured-greeting',
    description: 'Returns a plain object with outputSchema',
    parameters: z.object({ name: z.string().default('World') }),
    outputSchema: z.object({ greeting: z.string() }),
  })
  async greet({ name }) {
    return { greeting: `Hello, ${name}!` };
  }
}

@Injectable()
export class GreetingToolWithElicitation {
  @Tool({
    name: 'hello-world-elicitation',
    description:
      'Returns a greeting and simulates a long operation with progress updates',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHelloElicitation({ name }, context: Context, request: Request) {
    try {
      const res = context.mcpServer.server.getClientCapabilities();
      if (!res?.elicitation) {
        return {
          content: [
            {
              type: 'text',
              text: 'Elicitation is not supported by the client. Thus this tool cannot be used.',
            },
          ],
        };
      }

      const response = await context.mcpServer.server.elicitInput({
        message: 'Please provide your name',
        requestedSchema: {
          type: 'object',
          properties: {
            surname: { type: 'string', description: 'Your surname' },
          },
        },
      });
      let fullName = '';
      switch (response.action) {
        case 'accept': {
          const surname = response?.content?.surname as string;
          fullName = `${name} ${surname}`;
          break;
        }
        case 'decline':
        case 'cancel':
          fullName = name;
          break;
        default:
          fullName = name;
      }

      return {
        content: [{ type: 'text', text: `Hello, ${fullName}!` }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
    }
  }
}

describe('E2E: MCP ToolServer', () => {
  let app: INestApplication;
  let statelessApp: INestApplication;
  let statefulServerPort: number;
  let statelessServerPort: number;

  // Set timeout for all tests in this describe block to 15000ms
  jest.setTimeout(15000);

  beforeAll(async () => {
    // Create stateful server (original)
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-mcp-server',
          version: '0.0.1',
          guards: [],
          streamableHttp: {
            enableJsonResponse: false,
            sessionIdGenerator: () => randomUUID(),
            statelessMode: false,
          },
        }),
      ],
      providers: [
        GreetingTool,
        GreetingToolRequestScoped,
        MockUserRepository,
        ToolRequestScoped,
        OutputSchemaTool,
        NotMcpCompliantGreetingTool,
        NotMcpCompliantStructuredGreetingTool,
        InvalidOutputSchemaTool,
        ValidationTestTool,
        GreetingToolWithElicitation,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    if (!server.address()) {
      throw new Error('Server address not found after listen');
    }
    statefulServerPort = (server.address() as import('net').AddressInfo).port;

    // Create stateless server
    const statelessModuleFixture: TestingModule =
      await Test.createTestingModule({
        imports: [
          McpModule.forRoot({
            name: 'test-stateless-mcp-server',
            version: '0.0.1',
            guards: [],
            transport: McpTransportType.STREAMABLE_HTTP,
            streamableHttp: {
              enableJsonResponse: true,
              sessionIdGenerator: undefined,
              statelessMode: true,
            },
          }),
        ],
        providers: [
          GreetingTool,
          GreetingToolRequestScoped,
          MockUserRepository,
          ToolRequestScoped,
          OutputSchemaTool,
          NotMcpCompliantGreetingTool,
          NotMcpCompliantStructuredGreetingTool,
          InvalidOutputSchemaTool,
          ValidationTestTool,
          GreetingToolWithElicitation,
        ],
      }).compile();

    statelessApp = statelessModuleFixture.createNestApplication();
    await statelessApp.listen(0);

    const statelessServer = statelessApp.getHttpServer();
    if (!statelessServer.address()) {
      throw new Error('Stateless server address not found after listen');
    }
    statelessServerPort = (
      statelessServer.address() as import('net').AddressInfo
    ).port;
  });

  afterAll(async () => {
    await app.close();
    await statelessApp.close();
  });

  const runClientTests = (
    clientType: 'http+sse' | 'streamable http' | 'stdio',
    clientCreator: (port: number, options?: any) => Promise<Client>,
    requestScopedHeaderValue: string,
    stateless = false,
  ) => {
    describe(`using ${clientType} client (${clientCreator.name})`, () => {
      let port: number;

      beforeAll(async () => {
        port = stateless ? statelessServerPort : statefulServerPort;
      });
      it('should list tools', async () => {
        const client = await clientCreator(port);
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
          expect(
            tools.tools.find((t) => t.name === 'output-schema-tool'),
          ).toBeDefined();
          expect(
            tools.tools.find((t) => t.name === 'not-mcp-greeting'),
          ).toBeDefined();
          expect(
            tools.tools.find((t) => t.name === 'not-mcp-structured-greeting'),
          ).toBeDefined();
          expect(
            tools.tools.find((t) => t.name === 'invalid-output-schema-tool'),
          ).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should list tools with outputSchema', async () => {
        const client = await clientCreator(port);
        try {
          const tools = await client.listTools();
          expect(tools.tools.length).toBeGreaterThan(0);
          const outputSchemaTool = tools.tools.find(
            (t) => t.name === 'output-schema-tool',
          );
          expect(outputSchemaTool).toBeDefined();
          expect(outputSchemaTool?.outputSchema).toBeDefined();
          expect(outputSchemaTool?.outputSchema).toHaveProperty(
            'properties.result',
          );
        } finally {
          await client.close();
        }
      });

      it('should list tools without outputSchema', async () => {
        const client = await clientCreator(port);
        try {
          const tools = await client.listTools();
          expect(tools.tools.length).toBeGreaterThan(0);
          const schemaTool = tools.tools.find((t) => t.name === 'hello-world');
          expect(schemaTool?.outputSchema).not.toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should list tools with annotations', async () => {
        const client = await clientCreator(port);
        try {
          const tools = await client.listTools();
          expect(tools.tools.length).toBeGreaterThan(0);
          const annotatedTool = tools.tools.find(
            (t) => t.name === 'hello-world-with-annotations',
          );
          expect(annotatedTool).toBeDefined();
          expect(annotatedTool?.annotations).toBeDefined();
          expect(annotatedTool?.annotations?.title).toBe('Say Hello');
          expect(annotatedTool?.annotations?.readOnlyHint).toBe(true);
          expect(annotatedTool?.annotations?.openWorldHint).toBe(false);
        } finally {
          await client.close();
        }
      });

      it.each([{ tool: 'hello-world' }, { tool: 'hello-world-scoped' }])(
        'should call the tool $tool and receive results',
        async ({ tool }) => {
          const client = await clientCreator(port);
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

            if (clientType != 'stdio' && !stateless) {
              // stdio has no support for progress
              expect(progressCount).toBe(5);
            }
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
        const client = await clientCreator(port, {
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
        const client = await clientCreator(port);

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
        const client = await clientCreator(port);

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

      it('should test input validation with truly required parameters', async () => {
        const client = await clientCreator(port);

        try {
          await client.callTool({
            name: 'validation-test-tool',
            arguments: {}, // Missing both required parameters
          });
          // If we reach here, validation is NOT working
          expect(true).toBe(false); // Force failure
        } catch (error) {
          expect(error).toBeDefined();
          console.log('Validation error:', error.message);
          // Expect MCP InvalidParams error
          expect(
            error.message.includes('Invalid parameters') ||
              error.message.includes('Required') ||
              error.message.includes('string') ||
              error.message.includes('number') ||
              error.code === -32602, // ErrorCode.InvalidParams
          ).toBe(true);
        }

        await client.close();
      });

      it('should test input validation with wrong types', async () => {
        const client = await clientCreator(port);

        try {
          await client.callTool({
            name: 'validation-test-tool',
            arguments: {
              requiredString: 123, // Wrong type
              requiredNumber: 'not a number', // Wrong type
            },
          });
          // If we reach here, validation is NOT working
          expect(true).toBe(false); // Force failure
        } catch (error) {
          expect(error).toBeDefined();
          console.log('Type validation error:', error.message);
          // Expect MCP InvalidParams error
          expect(
            error.message.includes('Invalid parameters') ||
              error.message.includes('Expected string') ||
              error.message.includes('Expected number') ||
              error.code === -32602, // ErrorCode.InvalidParams
          ).toBe(true);
        }

        await client.close();
      });

      it('should call the tool and receive an error', async () => {
        const client = await clientCreator(port);
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

      it('should transform non-MCP-compliant response into MCP-compliant payload', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'not-mcp-greeting',
            arguments: { name: 'TestUser' },
          });
          expect(result).toHaveProperty('content');
          expect(Array.isArray(result.content)).toBe(true);
          expect(result.content[0].type).toBe('text');
          expect(result.content[0].text).toContain('greeting');
          expect(result.content[0].text).toContain('Hello, TestUser!');
        } finally {
          await client.close();
        }
      });

      it('should transform non-MCP-compliant response with outputSchema into MCP-compliant payload with structuredContent', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'not-mcp-structured-greeting',
            arguments: { name: 'TestUser' },
          });
          expect(result).toHaveProperty('structuredContent');
          expect(result.structuredContent).toEqual({
            greeting: 'Hello, TestUser!',
          });
          expect(result).toHaveProperty('content');
          expect(Array.isArray(result.content)).toBe(true);
          expect(result.content[0].type).toBe('text');
          expect(result.content[0].text).toContain('greeting');
          expect(result.content[0].text).toContain('Hello, TestUser!');
        } finally {
          await client.close();
        }
      });

      it('should throw an MCP error if tool result does not match outputSchema', async () => {
        const client = await clientCreator(port);
        try {
          await client.callTool({
            name: 'invalid-output-schema-tool',
            arguments: {},
          });
          // If we reach here, validation is NOT working
          expect(true).toBe(false); // Force failure
        } catch (error) {
          expect(error).toBeDefined();
          expect(error.message).toContain('Tool result does not match');
          expect(error.code).toBe(-32603); // ErrorCode.InternalError
        } finally {
          await client.close();
        }
      });
    });
  };

  // Elicitation tests
  const runElicitationTests = (
    clientType: 'http+sse' | 'streamable http',
    clientCreator: (port: number, options?: any) => Promise<Client>,
    stateless = false,
  ) => {
    describe(`Elicitation tests using ${clientType} client`, () => {
      let port: number;

      beforeAll(async () => {
        port = stateless ? statelessServerPort : statefulServerPort;
      });

      it('should handle elicitation in hello-world-elicitation tool', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'hello-world-elicitation',
            arguments: { name: 'TestUser' },
          });

          expect(result.content).toBeDefined();
          expect(result.content[0].type).toBe('text');
          expect(result.content[0].text).toContain(
            'Hello, TestUser TestSurname!',
          );
        } finally {
          await client.close();
        }
      });

      it('should list hello-world-elicitation tool', async () => {
        const client = await clientCreator(port);
        try {
          const tools = await client.listTools();
          const elicitationTool = tools.tools.find(
            (t) => t.name === 'hello-world-elicitation',
          );
          expect(elicitationTool).toBeDefined();
          expect(elicitationTool?.description).toContain('progress updates');
        } finally {
          await client.close();
        }
      });

      it('should handle declined elicitation gracefully', async () => {
        // Create a client that declines elicitation requests
        const client = await clientCreator(port);

        // Override the elicit request handler to decline
        client.setRequestHandler(ElicitRequestSchema, () => ({
          action: 'decline',
        }));

        try {
          const result: any = await client.callTool({
            name: 'hello-world-elicitation',
            arguments: { name: 'TestUser' },
          });

          expect(result.content).toBeDefined();
          expect(result.content[0].type).toBe('text');
          // Should use default surname when elicitation is declined
          expect(result.content[0].text).toContain('Hello, TestUser!');
        } finally {
          await client.close();
        }
      });

      it('should handle cancelled elicitation gracefully', async () => {
        // Create a client that cancels elicitation requests
        const client = await clientCreator(port);

        // Override the elicit request handler to cancel
        client.setRequestHandler(ElicitRequestSchema, () => ({
          action: 'cancel',
        }));

        try {
          const result: any = await client.callTool({
            name: 'hello-world-elicitation',
            arguments: { name: 'TestUser' },
          });

          expect(result.content).toBeDefined();
          expect(result.content[0].type).toBe('text');
          // Should use default surname when elicitation is cancelled
          expect(result.content[0].text).toContain('Hello, TestUser!');
        } finally {
          await client.close();
        }
      });
    });
  };

  // Run elicitation tests (supported only by stateful servers)
  runElicitationTests('http+sse', createSseClientWithElicitation);
  runElicitationTests('streamable http', createStreamableClientWithElicitation);

  // Test elicitation with non-elicitation clients
  describe('Elicitation with non-elicitation clients', () => {
    it('should handle elicitation tool call gracefully when client lacks elicitation capability', async () => {
      // Use a regular client without elicitation capabilities
      const client = await createSseClient(statefulServerPort);
      try {
        const result: any = await client.callTool({
          name: 'hello-world-elicitation',
          arguments: { name: 'TestUser' },
        });

        expect(result.content).toBeDefined();
        expect(result.content[0].type).toBe('text');
        // Should either error or fall back to default behavior
        expect(
          result.content[0].text.includes(
            'Elicitation is not supported by the client. Thus this tool cannot be used.',
          ),
        ).toBe(true);
      } finally {
        await client.close();
      }
    });
  });

  // Run tests using the HTTP+SSE MCP client
  runClientTests('http+sse', createSseClient, 'any-value');

  // Run tests using the [Stateful] Streamable HTTP MCP client
  runClientTests('streamable http', createStreamableClient, 'streamable-value');

  // Run tests using the [Stateless] Streamable HTTP MCP client
  runClientTests(
    'streamable http',
    createStreamableClient,
    'stateless-streamable-value',
    true,
  );

  runClientTests(
    'stdio',
    () =>
      createStdioClient({ serverScriptPath: 'tests/sample/stdio-server.ts' }),
    'No header (stdio)',
  );
});
