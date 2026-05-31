import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { INestApplication, Injectable, Scope } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { McpContext, McpController, Tool } from '../src';
import {
  bootstrapMcpApp,
  createSseClient,
  createStreamableClient,
  createSseClientWithElicitation,
  createStreamableClientWithElicitation,
  StreamableHttpTransport,
} from './utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

@Injectable()
class MockUserRepository {
  async findByName(name: string) {
    return Promise.resolve({
      id: 'user123',
      name: 'Repository User Name ' + name,
    });
  }
}

@McpController()
export class GreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that gets the user by name',
    parameters: z.object({ name: z.string().default('World') }),
  })
  async sayHello(@Payload() { name }: { name: string }, @Ctx() context: McpContext) {
    if (!context.mcpServer) throw new Error('mcpServer is not defined');
    if (!context.mcpRequest) throw new Error('mcpRequest is not defined');

    const user = await this.userRepository.findByName(name);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await context.reportProgress({ progress: (i + 1) * 20, total: 100 } as Progress);
    }
    return { content: [{ type: 'text', text: `Hello, ${user.name}!` }] };
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
    parameters: z.object({ name: z.string().default('World') }),
    annotations: { title: 'Say Hello', readOnlyHint: true, openWorldHint: false },
  })
  async sayHelloWithAnnotations(@Payload() { name }: { name: string }) {
    const user = await this.userRepository.findByName(name);
    return {
      content: [{ type: 'text', text: `Hello with annotations, ${user.name}!` }],
    };
  }

  @Tool({
    name: 'hello-world-with-meta',
    description: 'A sample tool with meta',
    parameters: z.object({ name: z.string().default('World') }),
    _meta: { title: 'Say Hello' },
  })
  async sayHelloWithMeta(@Payload() { name }: { name: string }) {
    const user = await this.userRepository.findByName(name);
    return {
      content: [{ type: 'text', text: `Hello with annotations, ${user.name}!` }],
    };
  }
}

@McpController()
@Injectable({ scope: Scope.REQUEST })
export class GreetingToolRequestScoped {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world-scoped',
    description: 'A sample request-scoped tool that gets the user by name',
    parameters: z.object({ name: z.string().default('World') }),
  })
  async sayHello(@Payload() { name }: { name: string }, @Ctx() context: McpContext) {
    const user = await this.userRepository.findByName(name);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await context.reportProgress({ progress: (i + 1) * 20, total: 100 } as Progress);
    }
    return { content: [{ type: 'text', text: `Hello, ${user.name}!` }] };
  }
}

@McpController()
export class HeaderTool {
  @Tool({
    name: 'get-request-scoped',
    description: 'Reads a header from the raw request via @Ctx()',
    parameters: z.object({}),
  })
  getRequest(@Ctx() ctx: McpContext) {
    const raw = ctx.getRawRequest<{ headers?: Record<string, string> }>();
    return {
      content: [
        { type: 'text', text: raw?.headers?.['any-header'] ?? 'No header found' },
      ],
    };
  }
}

@McpController()
class OutputSchemaTool {
  @Tool({
    name: 'output-schema-tool',
    description: 'A tool to test outputSchema',
    parameters: z.object({ input: z.string().describe('Example input') }),
    outputSchema: z.object({ result: z.string().describe('Example result') }),
  })
  async execute(@Payload() { input }: { input: string }) {
    return { content: [{ type: 'text', text: JSON.stringify({ result: input }) }] };
  }
}

@McpController()
class InvalidOutputSchemaTool {
  @Tool({
    name: 'invalid-output-schema-tool',
    description: 'Returns an object that does not match its outputSchema',
    parameters: z.object({}),
    outputSchema: z.object({ foo: z.string() }),
  })
  async execute() {
    return { bar: 123 };
  }
}

@McpController()
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
  async execute(
    @Payload()
    { requiredString, requiredNumber, optionalParam }: {
      requiredString: string;
      requiredNumber: number;
      optionalParam?: string;
    },
  ) {
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

@McpController()
class NotMcpCompliantGreetingTool {
  @Tool({
    name: 'not-mcp-greeting',
    description: 'Returns a plain object, not MCP-compliant',
    parameters: z.object({ name: z.string().default('World') }),
  })
  async greet(@Payload() { name }: { name: string }) {
    return { greeting: `Hello, ${name}!` };
  }
}

@McpController()
class NotMcpCompliantStructuredGreetingTool {
  @Tool({
    name: 'not-mcp-structured-greeting',
    description: 'Returns a plain object with outputSchema',
    parameters: z.object({ name: z.string().default('World') }),
    outputSchema: z.object({ greeting: z.string() }),
  })
  async greet(@Payload() { name }: { name: string }) {
    return { greeting: `Hello, ${name}!` };
  }
}

@McpController()
export class GreetingToolWithElicitation {
  @Tool({
    name: 'hello-world-elicitation',
    description:
      'Returns a greeting and simulates a long operation with progress updates',
    parameters: z.object({ name: z.string().default('World') }),
  })
  async sayHelloElicitation(
    @Payload() { name }: { name: string },
    @Ctx() context: McpContext,
  ) {
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
        default:
          fullName = name;
      }
      return { content: [{ type: 'text', text: `Hello, ${fullName}!` }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
    }
  }
}

const TOOL_CONTROLLERS = [
  GreetingTool,
  GreetingToolRequestScoped,
  HeaderTool,
  OutputSchemaTool,
  NotMcpCompliantGreetingTool,
  NotMcpCompliantStructuredGreetingTool,
  InvalidOutputSchemaTool,
  ValidationTestTool,
  GreetingToolWithElicitation,
];

describe('E2E: MCP ToolServer', () => {
  let app: INestApplication;
  let statelessApp: INestApplication;
  let statefulServerPort: number;
  let statelessServerPort: number;

  beforeAll(async () => {
    const stateful = await bootstrapMcpApp({
      name: 'test-mcp-server',
      controllers: TOOL_CONTROLLERS,
      providers: [MockUserRepository],
    });
    app = stateful.app;
    statefulServerPort = stateful.port;

    const stateless = await bootstrapMcpApp({
      name: 'test-stateless-mcp-server',
      controllers: TOOL_CONTROLLERS,
      providers: [MockUserRepository],
      transports: [new StreamableHttpTransport({ statelessMode: true })],
    });
    statelessApp = stateless.app;
    statelessServerPort = stateless.port;
  });

  afterAll(async () => {
    await app.close();
    await statelessApp.close();
  });

  const runClientTests = (
    clientType: 'http+sse' | 'streamable http',
    clientCreator: (port: number, options?: any) => Promise<Client>,
    requestScopedHeaderValue: string,
    stateless = false,
  ) => {
    describe(`using ${clientType} client${stateless ? ' (stateless)' : ''}`, () => {
      let port: number;
      beforeAll(() => {
        port = stateless ? statelessServerPort : statefulServerPort;
      });

      it('should list tools', async () => {
        const client = await clientCreator(port);
        try {
          const tools = await client.listTools();
          expect(tools.tools.find((t) => t.name === 'hello-world')).toBeDefined();
          expect(tools.tools.find((t) => t.name === 'hello-world-scoped')).toBeDefined();
          expect(tools.tools.find((t) => t.name === 'get-request-scoped')).toBeDefined();
          expect(tools.tools.find((t) => t.name === 'output-schema-tool')).toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should list tools with outputSchema', async () => {
        const client = await clientCreator(port);
        try {
          const tools = await client.listTools();
          const outputSchemaTool = tools.tools.find((t) => t.name === 'output-schema-tool');
          expect(outputSchemaTool?.outputSchema).toBeDefined();
          expect(outputSchemaTool?.outputSchema).toHaveProperty('properties.result');
        } finally {
          await client.close();
        }
      });

      it('should list tools without outputSchema', async () => {
        const client = await clientCreator(port);
        try {
          const tools = await client.listTools();
          const helloTool = tools.tools.find((t) => t.name === 'hello-world');
          expect(helloTool).toBeDefined();
          expect(helloTool?.outputSchema).not.toBeDefined();
        } finally {
          await client.close();
        }
      });

      it('should list tools with annotations', async () => {
        const client = await clientCreator(port);
        try {
          const tools = await client.listTools();
          const annotatedTool = tools.tools.find(
            (t) => t.name === 'hello-world-with-annotations',
          );
          expect(annotatedTool?.annotations?.title).toBe('Say Hello');
          expect(annotatedTool?.annotations?.readOnlyHint).toBe(true);
          expect(annotatedTool?.annotations?.openWorldHint).toBe(false);
        } finally {
          await client.close();
        }
      });

      it('should list tools with meta', async () => {
        const client = await clientCreator(port);
        try {
          const tools = await client.listTools();
          const metaTool = tools.tools.find((t) => t.name === 'hello-world-with-meta');
          expect(metaTool!._meta?.title).toBe('Say Hello');
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
            if (!stateless) {
              expect(progressCount).toBe(5);
            }
            expect(result.content[0].text).toContain(
              'Hello, Repository User Name userRepo123!',
            );
          } finally {
            await client.close();
          }
        },
      );

      it('should call get-request-scoped and receive header', async () => {
        const client = await clientCreator(port, {
          requestInit: { headers: { 'any-header': requestScopedHeaderValue } },
        });
        try {
          const result: any = await client.callTool({
            name: 'get-request-scoped',
            arguments: {},
          });
          expect(result.content[0].text).toContain(requestScopedHeaderValue);
        } finally {
          await client.close();
        }
      });

      it('should reject invalid arguments for hello-world', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'hello-world',
            arguments: { name: 123 } as any,
          });
          expect(result.isError).toBe(true);
          expect(result.content[0].text).toContain('Invalid parameters:');
          expect(result.content[0].text).toContain('[name]');
        } finally {
          await client.close();
        }
      });

      it('should accept missing arguments for hello-world (defaults)', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'hello-world',
            arguments: {} as any,
          });
          expect(result.isError).not.toBe(true);
          expect(result.content[0].text).toContain('Hello, Repository User Name World!');
        } finally {
          await client.close();
        }
      });

      it('should validate truly required parameters', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'validation-test-tool',
            arguments: {},
          });
          expect(result.isError).toBe(true);
          expect(result.content[0].text).toContain('[requiredString]');
          expect(result.content[0].text).toContain('[requiredNumber]');
        } finally {
          await client.close();
        }
      });

      it('should validate wrong parameter types', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'validation-test-tool',
            arguments: {
              requiredString: 123, // wrong type
              requiredNumber: 'not a number', // wrong type
            } as any,
          });
          expect(result.isError).toBe(true);
          expect(result.content[0].text).toContain('Invalid parameters:');
          expect(result.content[0].text).toContain('[requiredString]');
          expect(result.content[0].text).toContain('[requiredNumber]');
        } finally {
          await client.close();
        }
      });

      it('should call the tool and receive a graceful error result', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'hello-world-error',
            arguments: {},
          });
          // Unknown errors are masked by the NestJS RPC exception handler.
          // Use RpcException or an exception filter to surface a custom message.
          expect(result.isError).toBe(true);
          expect(result.content[0].type).toBe('text');
        } finally {
          await client.close();
        }
      });

      it('should transform non-MCP-compliant response', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'not-mcp-greeting',
            arguments: { name: 'TestUser' },
          });
          expect(Array.isArray(result.content)).toBe(true);
          expect(result.content[0].text).toContain('Hello, TestUser!');
        } finally {
          await client.close();
        }
      });

      it('should transform non-MCP response with outputSchema into structuredContent', async () => {
        const client = await clientCreator(port);
        try {
          const result: any = await client.callTool({
            name: 'not-mcp-structured-greeting',
            arguments: { name: 'TestUser' },
          });
          expect(result.structuredContent).toEqual({ greeting: 'Hello, TestUser!' });
        } finally {
          await client.close();
        }
      });

      it('should throw an MCP error if result does not match outputSchema', async () => {
        const client = await clientCreator(port);
        try {
          await client.callTool({ name: 'invalid-output-schema-tool', arguments: {} });
          expect(true).toBe(false);
        } catch (error: any) {
          expect(error.message).toContain('Tool result does not match');
          expect(error.code).toBe(-32603);
        } finally {
          await client.close();
        }
      });
    });
  };

  const runElicitationTests = (
    clientType: 'http+sse' | 'streamable http',
    clientCreator: (port: number, options?: any) => Promise<Client>,
  ) => {
    describe(`Elicitation tests using ${clientType} client`, () => {
      it('should list hello-world-elicitation tool', async () => {
        const client = await clientCreator(statefulServerPort);
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

      it('should handle elicitation in hello-world-elicitation tool', async () => {
        const client = await clientCreator(statefulServerPort);
        try {
          const result: any = await client.callTool({
            name: 'hello-world-elicitation',
            arguments: { name: 'TestUser' },
          });
          expect(result.content[0].text).toContain('Hello, TestUser TestSurname!');
        } finally {
          await client.close();
        }
      });

      it('should handle declined elicitation gracefully', async () => {
        const client = await clientCreator(statefulServerPort);
        client.setRequestHandler(ElicitRequestSchema, () => ({ action: 'decline' }));
        try {
          const result: any = await client.callTool({
            name: 'hello-world-elicitation',
            arguments: { name: 'TestUser' },
          });
          expect(result.content[0].text).toContain('Hello, TestUser!');
        } finally {
          await client.close();
        }
      });

      it('should handle cancelled elicitation gracefully', async () => {
        const client = await clientCreator(statefulServerPort);
        client.setRequestHandler(ElicitRequestSchema, () => ({ action: 'cancel' }));
        try {
          const result: any = await client.callTool({
            name: 'hello-world-elicitation',
            arguments: { name: 'TestUser' },
          });
          // Falls back to the default surname when elicitation is cancelled.
          expect(result.content[0].text).toContain('Hello, TestUser!');
        } finally {
          await client.close();
        }
      });
    });
  };

  runElicitationTests('http+sse', createSseClientWithElicitation);
  runElicitationTests('streamable http', createStreamableClientWithElicitation);

  describe('Elicitation with non-elicitation clients', () => {
    it('falls back gracefully when client lacks elicitation capability', async () => {
      const client = await createSseClient(statefulServerPort);
      try {
        const result: any = await client.callTool({
          name: 'hello-world-elicitation',
          arguments: { name: 'TestUser' },
        });
        expect(result.content[0].text).toContain(
          'Elicitation is not supported by the client',
        );
      } finally {
        await client.close();
      }
    });
  });

  runClientTests('http+sse', createSseClient, 'any-value');
  runClientTests('streamable http', createStreamableClient, 'streamable-value');
  runClientTests('streamable http', createStreamableClient, 'stateless-value', true);
});
