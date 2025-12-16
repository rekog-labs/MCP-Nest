import {
  INestApplication,
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Tool } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import {
  createSseClient,
  createStreamableClient,
  createStdioClient,
} from './utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { randomUUID } from 'crypto';

/**
 * Guard that allows access only to admin users.
 */
@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return request?.user?.role === 'admin';
  }
}

/**
 * Guard that allows access to any authenticated user.
 */
@Injectable()
class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return !!request?.user;
  }
}

/**
 * Guard that simulates an async check.
 */
@Injectable()
class AsyncGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    await new Promise((resolve) => setTimeout(resolve, 10));
    return request?.user?.hasAsyncPermission === true;
  }
}

/**
 * Transport-level guard that sets user on request based on Authorization header.
 */
@Injectable()
class MockTransportAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request?.headers?.authorization;

    if (authHeader === 'Bearer admin-token') {
      request.user = { role: 'admin', hasAsyncPermission: true };
      return true;
    }
    if (authHeader === 'Bearer user-token') {
      request.user = { role: 'user', hasAsyncPermission: false };
      return true;
    }
    if (authHeader === 'Bearer async-user-token') {
      request.user = { role: 'user', hasAsyncPermission: true };
      return true;
    }

    return false;
  }
}

/**
 * Tool service with various guard configurations.
 */
@Injectable()
class GuardedToolsService {
  @Tool({
    name: 'public-tool',
    description: 'A public tool accessible to everyone',
    parameters: z.object({}),
  })
  async publicTool() {
    return {
      content: [{ type: 'text', text: 'Public tool executed' }],
    };
  }

  @Tool({
    name: 'authenticated-tool',
    description: 'Tool requiring authentication',
    parameters: z.object({}),
    guards: [AuthenticatedGuard],
  })
  async authenticatedTool() {
    return {
      content: [{ type: 'text', text: 'Authenticated tool executed' }],
    };
  }

  @Tool({
    name: 'admin-tool',
    description: 'Tool requiring admin role',
    parameters: z.object({}),
    guards: [AdminGuard],
  })
  async adminTool() {
    return {
      content: [{ type: 'text', text: 'Admin tool executed' }],
    };
  }

  @Tool({
    name: 'multi-guard-tool',
    description: 'Tool requiring multiple guards (AND logic)',
    parameters: z.object({}),
    guards: [AuthenticatedGuard, AdminGuard],
  })
  async multiGuardTool() {
    return {
      content: [{ type: 'text', text: 'Multi-guard tool executed' }],
    };
  }

  @Tool({
    name: 'async-guard-tool',
    description: 'Tool with async guard',
    parameters: z.object({}),
    guards: [AsyncGuard],
  })
  async asyncGuardTool() {
    return {
      content: [{ type: 'text', text: 'Async guard tool executed' }],
    };
  }

  @Tool({
    name: 'tool-with-args',
    description: 'A guarded tool that accepts arguments',
    parameters: z.object({
      message: z.string(),
    }),
    guards: [AuthenticatedGuard],
  })
  async toolWithArgs({ message }: { message: string }) {
    return {
      content: [{ type: 'text', text: `Echo: ${message}` }],
    };
  }
}

describe('E2E: MCP Tool Guards', () => {
  let app: INestApplication;
  let statelessApp: INestApplication;
  let statefulServerPort: number;
  let statelessServerPort: number;

  jest.setTimeout(30000);

  beforeAll(async () => {
    // Create stateful server
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-guards-mcp-server',
          version: '0.0.1',
          guards: [MockTransportAuthGuard],
          streamableHttp: {
            enableJsonResponse: false,
            sessionIdGenerator: () => randomUUID(),
            statelessMode: false,
          },
        }),
      ],
      providers: [
        GuardedToolsService,
        AdminGuard,
        AuthenticatedGuard,
        AsyncGuard,
        MockTransportAuthGuard,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);
    statefulServerPort = (app.getHttpServer().address() as import('net').AddressInfo).port;

    // Create stateless server
    const statelessModuleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-guards-stateless-mcp-server',
          version: '0.0.1',
          guards: [MockTransportAuthGuard],
          streamableHttp: {
            enableJsonResponse: true,
            sessionIdGenerator: undefined,
            statelessMode: true,
          },
        }),
      ],
      providers: [
        GuardedToolsService,
        AdminGuard,
        AuthenticatedGuard,
        AsyncGuard,
        MockTransportAuthGuard,
      ],
    }).compile();

    statelessApp = statelessModuleFixture.createNestApplication();
    await statelessApp.listen(0);
    statelessServerPort = (statelessApp.getHttpServer().address() as import('net').AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
    await statelessApp.close();
  });

  /**
   * Parameterized test runner for HTTP transports.
   * Tests guard filtering for listing and execution.
   */
  const runHttpGuardTests = (
    clientType: 'http+sse' | 'streamable http',
    clientCreator: (port: number, options?: { requestInit?: RequestInit }) => Promise<Client>,
    stateless = false,
  ) => {
    describe(`using ${clientType} client${stateless ? ' (stateless)' : ''}`, () => {
      let port: number;

      beforeAll(() => {
        port = stateless ? statelessServerPort : statefulServerPort;
      });

      describe('Tool Listing', () => {
        it('admin should see all tools', async () => {
          const client = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer admin-token' } },
          });

          try {
            const tools = await client.listTools();
            const toolNames = tools.tools.map((t) => t.name);

            expect(toolNames).toContain('public-tool');
            expect(toolNames).toContain('authenticated-tool');
            expect(toolNames).toContain('admin-tool');
            expect(toolNames).toContain('multi-guard-tool');
            expect(toolNames).toContain('async-guard-tool');
            expect(toolNames).toContain('tool-with-args');
          } finally {
            await client.close();
          }
        });

        it('regular user should not see admin-only tools', async () => {
          const client = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer user-token' } },
          });

          try {
            const tools = await client.listTools();
            const toolNames = tools.tools.map((t) => t.name);

            expect(toolNames).toContain('public-tool');
            expect(toolNames).toContain('authenticated-tool');
            expect(toolNames).not.toContain('admin-tool');
            expect(toolNames).not.toContain('multi-guard-tool');
            expect(toolNames).not.toContain('async-guard-tool');
            expect(toolNames).toContain('tool-with-args');
          } finally {
            await client.close();
          }
        });

        it('async-user should see async-guard-tool', async () => {
          const client = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer async-user-token' } },
          });

          try {
            const tools = await client.listTools();
            const toolNames = tools.tools.map((t) => t.name);

            expect(toolNames).toContain('async-guard-tool');
            expect(toolNames).not.toContain('admin-tool');
          } finally {
            await client.close();
          }
        });
      });

      describe('Tool Execution', () => {
        it('admin can execute admin-tool', async () => {
          const client = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer admin-token' } },
          });

          try {
            const result = await client.callTool({ name: 'admin-tool', arguments: {} });
            expect((result.content as Array<{ text: string }>)[0].text).toBe('Admin tool executed');
          } finally {
            await client.close();
          }
        });

        it('regular user cannot execute admin-tool', async () => {
          const client = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer user-token' } },
          });

          try {
            await client.callTool({ name: 'admin-tool', arguments: {} });
            fail('Expected an error to be thrown');
          } catch (error) {
            expect(error.message).toContain('Access denied');
          } finally {
            await client.close();
          }
        });

        it('authenticated user can execute authenticated-tool', async () => {
          const client = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer user-token' } },
          });

          try {
            const result = await client.callTool({ name: 'authenticated-tool', arguments: {} });
            expect((result.content as Array<{ text: string }>)[0].text).toBe('Authenticated tool executed');
          } finally {
            await client.close();
          }
        });

        it('anyone can execute public-tool', async () => {
          const client = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer user-token' } },
          });

          try {
            const result = await client.callTool({ name: 'public-tool', arguments: {} });
            expect((result.content as Array<{ text: string }>)[0].text).toBe('Public tool executed');
          } finally {
            await client.close();
          }
        });

        it('multi-guard-tool requires both guards to pass', async () => {
          // Admin passes both guards
          const adminClient = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer admin-token' } },
          });

          try {
            const result = await adminClient.callTool({ name: 'multi-guard-tool', arguments: {} });
            expect((result.content as Array<{ text: string }>)[0].text).toBe('Multi-guard tool executed');
          } finally {
            await adminClient.close();
          }

          // Regular user fails AdminGuard
          const userClient = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer user-token' } },
          });

          try {
            await userClient.callTool({ name: 'multi-guard-tool', arguments: {} });
            fail('Expected an error to be thrown');
          } catch (error) {
            expect(error.message).toContain('Access denied');
          } finally {
            await userClient.close();
          }
        });

        it('async guards work correctly', async () => {
          const client = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer async-user-token' } },
          });

          try {
            const result = await client.callTool({ name: 'async-guard-tool', arguments: {} });
            expect((result.content as Array<{ text: string }>)[0].text).toBe('Async guard tool executed');
          } finally {
            await client.close();
          }
        });

        it('guarded tool with args works correctly', async () => {
          const client = await clientCreator(port, {
            requestInit: { headers: { Authorization: 'Bearer user-token' } },
          });

          try {
            const result = await client.callTool({
              name: 'tool-with-args',
              arguments: { message: 'Hello World' },
            });
            expect((result.content as Array<{ text: string }>)[0].text).toBe('Echo: Hello World');
          } finally {
            await client.close();
          }
        });
      });
    });
  };

  // Run guard tests for HTTP+SSE transport (stateful)
  runHttpGuardTests('http+sse', createSseClient);

  // Run guard tests for Streamable HTTP transport (stateful)
  runHttpGuardTests('streamable http', createStreamableClient);

  // Run guard tests for Streamable HTTP transport (stateless)
  runHttpGuardTests('streamable http', createStreamableClient, true);

  /**
   * STDIO transport tests - guards should NOT work since there's no HTTP context.
   * Guarded tools should be hidden from listing.
   */
  describe('using stdio client (guards not supported)', () => {
    it('should only show public tools (guarded tools are hidden)', async () => {
      const client = await createStdioClient({
        serverScriptPath: 'tests/sample/stdio-server.ts',
      });

      try {
        const tools = await client.listTools();
        const toolNames = tools.tools.map((t) => t.name);

        // Only public-tool should be visible
        expect(toolNames).toContain('public-tool');

        // Guarded tools should be hidden (guards fail without HTTP context)
        expect(toolNames).not.toContain('authenticated-tool');
        expect(toolNames).not.toContain('admin-tool');
      } finally {
        await client.close();
      }
    });

    it('public tool can still be executed', async () => {
      const client = await createStdioClient({
        serverScriptPath: 'tests/sample/stdio-server.ts',
      });

      try {
        const result = await client.callTool({ name: 'public-tool', arguments: {} });
        expect((result.content as Array<{ text: string }>)[0].text).toBe('Public tool executed');
      } finally {
        await client.close();
      }
    });
  });
});
