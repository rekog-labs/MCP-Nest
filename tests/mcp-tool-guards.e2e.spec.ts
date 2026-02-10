import { INestApplication, Injectable, SetMetadata } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { Tool, ToolGuards, PublicTool } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { createSseClient, createStreamableClient } from './utils';
import { McpTransportType } from '../src';

/**
 * Guard that checks for admin role via request.user.role
 */
@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return request?.user?.role === 'admin';
  }
}

/**
 * Guard that checks for any authenticated user
 */
@Injectable()
class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return !!request?.user;
  }
}

/**
 * Guard that returns a promise (async guard)
 */
@Injectable()
class AsyncGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    return !!request?.user?.asyncAllowed;
  }
}

/**
 * Custom decorator that stores a required role as metadata on the method.
 */
const RequiredRole = (role: string) => SetMetadata('required-role', role);

/**
 * Guard that reads metadata from the handler method via Reflector.
 * This validates that getHandler() returns the real method reference.
 */
@Injectable()
class ReflectorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRole = this.reflector.get<string>(
      'required-role',
      context.getHandler(),
    );
    if (!requiredRole) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    return request?.user?.role === requiredRole;
  }
}

/**
 * Guard that calls getResponse() - an unavailable method.
 * Should throw, causing the tool to be hidden.
 */
@Injectable()
class ResponseAccessGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getResponse();
    return true;
  }
}

/**
 * Mock transport-level guard that parses Authorization header and sets user on request.
 * Allows unauthenticated requests through for per-tool auth to handle.
 */
@Injectable()
class MockTransportAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization;

    if (!authHeader) {
      return true;
    }

    if (authHeader.includes('admin-token')) {
      request.user = { role: 'admin', name: 'Admin', asyncAllowed: true };
      return true;
    }

    if (authHeader.includes('user-token')) {
      request.user = { role: 'user', name: 'Regular User' };
      return true;
    }

    if (authHeader.includes('async-token')) {
      request.user = { role: 'viewer', name: 'Async User', asyncAllowed: true };
      return true;
    }

    return false;
  }
}

@Injectable()
class GuardedTools {
  @Tool({
    name: 'public-tool',
    description: 'A public tool accessible to everyone',
    parameters: z.object({}),
  })
  @PublicTool()
  async publicTool() {
    return { content: [{ type: 'text', text: 'Public tool executed' }] };
  }

  @Tool({
    name: 'authenticated-tool',
    description: 'Tool requiring authentication',
    parameters: z.object({}),
  })
  @ToolGuards([AuthenticatedGuard])
  async authenticatedTool() {
    return {
      content: [{ type: 'text', text: 'Authenticated tool executed' }],
    };
  }

  @Tool({
    name: 'admin-tool',
    description: 'Tool requiring admin role',
    parameters: z.object({}),
  })
  @ToolGuards([AdminGuard])
  async adminTool() {
    return { content: [{ type: 'text', text: 'Admin tool executed' }] };
  }

  @Tool({
    name: 'multi-guard-tool',
    description: 'Tool requiring both authentication and admin role',
    parameters: z.object({}),
  })
  @ToolGuards([AuthenticatedGuard, AdminGuard])
  async multiGuardTool() {
    return { content: [{ type: 'text', text: 'Multi-guard tool executed' }] };
  }

  @Tool({
    name: 'async-guard-tool',
    description: 'Tool with async guard',
    parameters: z.object({}),
  })
  @ToolGuards([AsyncGuard])
  async asyncGuardTool() {
    return { content: [{ type: 'text', text: 'Async guard tool executed' }] };
  }

  @Tool({
    name: 'guarded-with-args',
    description: 'Guarded tool with parameters',
    parameters: z.object({
      message: z.string(),
    }),
  })
  @ToolGuards([AuthenticatedGuard])
  async guardedWithArgs({ message }) {
    return { content: [{ type: 'text', text: `Echo: ${message}` }] };
  }

  @Tool({
    name: 'reflector-guard-tool',
    description: 'Tool with a Reflector-based guard reading method metadata',
    parameters: z.object({}),
  })
  @ToolGuards([ReflectorGuard])
  @RequiredRole('admin')
  async reflectorGuardTool() {
    return {
      content: [{ type: 'text', text: 'Reflector guard tool executed' }],
    };
  }

  @Tool({
    name: 'bad-guard-tool',
    description: 'Tool with a guard that accesses an unavailable context method',
    parameters: z.object({}),
  })
  @ToolGuards([ResponseAccessGuard])
  async badGuardTool() {
    return { content: [{ type: 'text', text: 'Should never execute' }] };
  }
}

describe('E2E: Tool Guards via @ToolGuards()', () => {
  describe.each([
    {
      transportName: 'SSE',
      transport: McpTransportType.SSE,
      createClient: (port: number, headers?: Record<string, string>) =>
        createSseClient(port, headers ? { requestInit: { headers } } : {}),
    },
    {
      transportName: 'Streamable HTTP (stateful)',
      transport: McpTransportType.STREAMABLE_HTTP,
      createClient: (port: number, headers?: Record<string, string>) =>
        createStreamableClient(port, headers ? { requestInit: { headers } } : {}),
    },
  ])('$transportName transport', ({ transport, createClient }) => {
    let app: INestApplication;
    let testPort: number;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
          McpModule.forRoot({
            name: 'test-tool-guards-server',
            version: '0.0.1',
            transport,
            guards: [MockTransportAuthGuard],
            allowUnauthenticatedAccess: true,
          }),
        ],
        providers: [
          GuardedTools,
          MockTransportAuthGuard,
          AdminGuard,
          AuthenticatedGuard,
          AsyncGuard,
          ReflectorGuard,
          ResponseAccessGuard,
        ],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);
      testPort = app.getHttpServer().address().port;
    });

    afterAll(async () => {
      await app.close();
    });

    describe('Tool Listing', () => {
      it('should list only unguarded tools when unauthenticated', async () => {
        const client = await createClient(testPort);

        const tools = await client.listTools();
        const toolNames = tools.tools.map((t) => t.name);

        expect(toolNames).toContain('public-tool');
        expect(toolNames).not.toContain('authenticated-tool');
        expect(toolNames).not.toContain('admin-tool');
        expect(toolNames).not.toContain('multi-guard-tool');
        expect(toolNames).not.toContain('async-guard-tool');
        expect(toolNames).not.toContain('guarded-with-args');

        await client.close();
      });

      it('should list tools the user has access to (regular user)', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const tools = await client.listTools();
        const toolNames = tools.tools.map((t) => t.name);

        expect(toolNames).toContain('public-tool');
        expect(toolNames).toContain('authenticated-tool');
        expect(toolNames).toContain('guarded-with-args');
        expect(toolNames).not.toContain('admin-tool');
        expect(toolNames).not.toContain('multi-guard-tool');
        expect(toolNames).not.toContain('async-guard-tool');

        await client.close();
      });

      it('should list all tools for admin user', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer admin-token',
        });

        const tools = await client.listTools();
        const toolNames = tools.tools.map((t) => t.name);

        expect(toolNames).toContain('public-tool');
        expect(toolNames).toContain('authenticated-tool');
        expect(toolNames).toContain('admin-tool');
        expect(toolNames).toContain('multi-guard-tool');
        expect(toolNames).toContain('async-guard-tool');
        expect(toolNames).toContain('guarded-with-args');

        await client.close();
      });

      it('should support Reflector-based guards reading method metadata', async () => {
        const adminClient = await createClient(testPort, {
          Authorization: 'Bearer admin-token',
        });
        const adminTools = await adminClient.listTools();
        const adminToolNames = adminTools.tools.map((t) => t.name);
        expect(adminToolNames).toContain('reflector-guard-tool');
        await adminClient.close();

        const userClient = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });
        const userTools = await userClient.listTools();
        const userToolNames = userTools.tools.map((t) => t.name);
        expect(userToolNames).not.toContain('reflector-guard-tool');
        await userClient.close();
      });

      it('should hide tools when guard accesses an unavailable context method', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer admin-token',
        });

        const tools = await client.listTools();
        const toolNames = tools.tools.map((t) => t.name);

        // The guard calls getResponse() which throws, so the tool is hidden
        expect(toolNames).not.toContain('bad-guard-tool');

        await client.close();
      });

      it('should show tools for async-allowed user', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer async-token',
        });

        const tools = await client.listTools();
        const toolNames = tools.tools.map((t) => t.name);

        expect(toolNames).toContain('public-tool');
        expect(toolNames).toContain('authenticated-tool');
        expect(toolNames).toContain('async-guard-tool');
        expect(toolNames).not.toContain('admin-tool');

        await client.close();
      });
    });

    describe('Tool Execution', () => {
      it('should allow calling unguarded tools without auth', async () => {
        const client = await createClient(testPort);

        const result = await client.callTool({
          name: 'public-tool',
          arguments: {},
        });

        expect((result.content as { type: string; text: string }[])[0].text).toBe(
          'Public tool executed',
        );

        await client.close();
      });

      it('should deny execution of guarded tools without auth', async () => {
        const client = await createClient(testPort);

        await expect(
          client.callTool({
            name: 'authenticated-tool',
            arguments: {},
          }),
        ).rejects.toThrow();

        await client.close();
      });

      it('should allow execution of guarded tools with proper auth', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const result = await client.callTool({
          name: 'authenticated-tool',
          arguments: {},
        });

        expect((result.content as { type: string; text: string }[])[0].text).toBe(
          'Authenticated tool executed',
        );

        await client.close();
      });

      it('should deny admin tools to regular users', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        await expect(
          client.callTool({
            name: 'admin-tool',
            arguments: {},
          }),
        ).rejects.toThrow();

        await client.close();
      });

      it('should allow admin tools to admin users', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer admin-token',
        });

        const result = await client.callTool({
          name: 'admin-tool',
          arguments: {},
        });

        expect((result.content as { type: string; text: string }[])[0].text).toBe(
          'Admin tool executed',
        );

        await client.close();
      });

      it('should require ALL guards to pass for multi-guard tools', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        await expect(
          client.callTool({
            name: 'multi-guard-tool',
            arguments: {},
          }),
        ).rejects.toThrow();

        await client.close();
      });

      it('should allow multi-guard tools when all guards pass', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer admin-token',
        });

        const result = await client.callTool({
          name: 'multi-guard-tool',
          arguments: {},
        });

        expect((result.content as { type: string; text: string }[])[0].text).toBe(
          'Multi-guard tool executed',
        );

        await client.close();
      });

      it('should support async guards', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer async-token',
        });

        const result = await client.callTool({
          name: 'async-guard-tool',
          arguments: {},
        });

        expect((result.content as { type: string; text: string }[])[0].text).toBe(
          'Async guard tool executed',
        );

        await client.close();
      });

      it('should pass arguments correctly to guarded tools', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const result = await client.callTool({
          name: 'guarded-with-args',
          arguments: { message: 'hello world' },
        });

        expect((result.content as { type: string; text: string }[])[0].text).toBe(
          'Echo: hello world',
        );

        await client.close();
      });
    });
  });
});
