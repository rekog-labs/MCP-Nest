import {
  ExecutionContext,
  Injectable,
  INestApplication,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { z } from 'zod';
import { Payload } from '@nestjs/microservices';
import { CanActivate } from '@nestjs/common';
import { McpContext, McpController, Tool, PublicTool } from '../src';
import {
  bootstrapMcpApp,
  createSseClient,
  createStreamableClient,
  StreamableHttpTransport,
  SseTransport,
} from './utils';

/**
 * Migrated from `@ToolGuards([...])` to native `@UseGuards([...])`.
 *
 * `@ToolGuards()` is no longer enforced by the strategy. Native guards run
 * during the RPC pipeline (i.e. at tool *call* time, not at list time), so
 * guarded tools are still visible in `listTools`. The intent — that guards
 * gate access — is preserved by asserting CALL-TIME denial (the tool call
 * returns isError / the client rejects) instead of list filtering.
 *
 * RPC-style guards read:
 *   - the user via `ctx.switchToRpc().getContext().getRawRequest().user`
 *   - the tool arguments via `ctx.switchToRpc().getData()`
 *
 * Authentication itself is Express middleware that parses the Authorization
 * header and sets `req.user`, allowing unauthenticated requests through so the
 * per-tool guards decide access.
 */

function getUser(context: ExecutionContext): any {
  const rpcCtx = context.switchToRpc().getContext<McpContext>();
  return rpcCtx.getRawRequest<{ user?: any }>()?.user;
}

/**
 * Guard that checks for admin role via the request user.
 */
@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return getUser(context)?.role === 'admin';
  }
}

/**
 * Guard that checks for any authenticated user.
 */
@Injectable()
class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    return !!getUser(context);
  }
}

/**
 * Guard that returns a promise (async guard).
 */
@Injectable()
class AsyncGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    return !!getUser(context)?.asyncAllowed;
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
    return getUser(context)?.role === requiredRole;
  }
}

/**
 * Guard that checks entity ownership via the tool arguments (RPC payload).
 * Simulates a real-world entity-modify guard that reads the tool input to
 * determine if the user owns the entity being modified.
 */
@Injectable()
class OwnershipGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const body = context.switchToRpc().getData<{ ownerId?: string }>();
    const user = getUser(context);

    if (!body || !body.ownerId) {
      return true;
    }

    return body.ownerId === user?.id;
  }
}

const authMiddleware = (req: any, _res: any, next: () => void) => {
  const authHeader = req.headers?.authorization;

  if (!authHeader) {
    return next();
  }

  if (authHeader.includes('admin-token')) {
    req.user = {
      id: 'admin-1',
      role: 'admin',
      name: 'Admin',
      asyncAllowed: true,
    };
    return next();
  }

  if (authHeader.includes('user-token')) {
    req.user = { id: 'user-1', role: 'user', name: 'Regular User' };
    return next();
  }

  if (authHeader.includes('async-token')) {
    req.user = {
      id: 'async-1',
      role: 'viewer',
      name: 'Async User',
      asyncAllowed: true,
    };
    return next();
  }

  next();
};

@McpController()
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
  @UseGuards(AuthenticatedGuard)
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
  @UseGuards(AdminGuard)
  async adminTool() {
    return { content: [{ type: 'text', text: 'Admin tool executed' }] };
  }

  @Tool({
    name: 'multi-guard-tool',
    description: 'Tool requiring both authentication and admin role',
    parameters: z.object({}),
  })
  @UseGuards(AuthenticatedGuard, AdminGuard)
  async multiGuardTool() {
    return { content: [{ type: 'text', text: 'Multi-guard tool executed' }] };
  }

  @Tool({
    name: 'async-guard-tool',
    description: 'Tool with async guard',
    parameters: z.object({}),
  })
  @UseGuards(AsyncGuard)
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
  @UseGuards(AuthenticatedGuard)
  async guardedWithArgs(@Payload() { message }: { message: string }) {
    return { content: [{ type: 'text', text: `Echo: ${message}` }] };
  }

  @Tool({
    name: 'reflector-guard-tool',
    description: 'Tool with a Reflector-based guard reading method metadata',
    parameters: z.object({}),
  })
  @UseGuards(ReflectorGuard)
  @RequiredRole('admin')
  async reflectorGuardTool() {
    return {
      content: [{ type: 'text', text: 'Reflector guard tool executed' }],
    };
  }

  @Tool({
    name: 'ownership-tool',
    description: 'Tool with an ownership guard that reads tool arguments',
    parameters: z.object({
      ownerId: z.string(),
      title: z.string(),
    }),
  })
  @UseGuards(OwnershipGuard)
  async ownershipTool(
    @Payload() { ownerId, title }: { ownerId: string; title: string },
  ) {
    return {
      content: [{ type: 'text', text: `Updated: ${title} (owner: ${ownerId})` }],
    };
  }
}

describe('E2E: Tool Guards via native @UseGuards()', () => {
  describe.each([
    {
      transportName: 'SSE',
      makeTransports: () => [new SseTransport()],
      createClient: (port: number, headers?: Record<string, string>) =>
        createSseClient(port, headers ? { requestInit: { headers } } : {}),
    },
    {
      transportName: 'Streamable HTTP (stateful)',
      makeTransports: () => [new StreamableHttpTransport({ statelessMode: false })],
      createClient: (port: number, headers?: Record<string, string>) =>
        createStreamableClient(
          port,
          headers ? { requestInit: { headers } } : {},
        ),
    },
  ])('$transportName transport', ({ makeTransports, createClient }) => {
    let app: INestApplication;
    let testPort: number;

    beforeAll(async () => {
      const bootstrapped = await bootstrapMcpApp({
        name: 'test-tool-guards-server',
        controllers: [GuardedTools],
        providers: [
          AdminGuard,
          AuthenticatedGuard,
          AsyncGuard,
          ReflectorGuard,
          OwnershipGuard,
        ],
        transports: makeTransports(),
        // No module-level `guards`/`allowUnauthenticatedAccess`: gating here is
        // done purely by native @UseGuards at call time, so the bespoke
        // ToolAuthorizationService stays out of the way (moduleHasGuards=false).
        configure: (nestApp) => {
          nestApp.use(authMiddleware);
        },
      });
      app = bootstrapped.app;
      testPort = bootstrapped.port;
    });

    afterAll(async () => {
      await app.close();
    });

    describe('Tool Listing', () => {
      // NOTE: native @UseGuards run at CALL time, not list time, so guarded
      // tools remain visible in listings regardless of auth. We assert the
      // public tool is always listed; access control is verified at call time
      // in the "Tool Execution" block below.
      it('should list the public tool (and guarded tools) when unauthenticated', async () => {
        const client = await createClient(testPort);

        const tools = await client.listTools();
        const toolNames = tools.tools.map((t) => t.name);

        expect(toolNames).toContain('public-tool');
        // Guarded tools are still visible — native guards gate at call time.
        expect(toolNames).toContain('authenticated-tool');
        expect(toolNames).toContain('admin-tool');

        await client.close();
      });

      it('should list tools for an authenticated user', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const tools = await client.listTools();
        const toolNames = tools.tools.map((t) => t.name);

        expect(toolNames).toContain('public-tool');
        expect(toolNames).toContain('authenticated-tool');
        expect(toolNames).toContain('guarded-with-args');

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

        expect(
          (result.content as { type: string; text: string }[])[0].text,
        ).toBe('Public tool executed');

        await client.close();
      });

      it('should deny execution of guarded tools without auth', async () => {
        const client = await createClient(testPort);

        const result: any = await client.callTool({
          name: 'authenticated-tool',
          arguments: {},
        });
        expect(result.isError).toBe(true);

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

        expect(
          (result.content as { type: string; text: string }[])[0].text,
        ).toBe('Authenticated tool executed');

        await client.close();
      });

      it('should deny admin tools to regular users', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const result: any = await client.callTool({
          name: 'admin-tool',
          arguments: {},
        });
        expect(result.isError).toBe(true);

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

        expect(
          (result.content as { type: string; text: string }[])[0].text,
        ).toBe('Admin tool executed');

        await client.close();
      });

      it('should require ALL guards to pass for multi-guard tools', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const result: any = await client.callTool({
          name: 'multi-guard-tool',
          arguments: {},
        });
        expect(result.isError).toBe(true);

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

        expect(
          (result.content as { type: string; text: string }[])[0].text,
        ).toBe('Multi-guard tool executed');

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

        expect(
          (result.content as { type: string; text: string }[])[0].text,
        ).toBe('Async guard tool executed');

        await client.close();
      });

      it('should deny async guard tools for non-async-allowed users', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const result: any = await client.callTool({
          name: 'async-guard-tool',
          arguments: {},
        });
        expect(result.isError).toBe(true);

        await client.close();
      });

      it('should support Reflector-based guards reading method metadata', async () => {
        const adminClient = await createClient(testPort, {
          Authorization: 'Bearer admin-token',
        });
        const adminResult = await adminClient.callTool({
          name: 'reflector-guard-tool',
          arguments: {},
        });
        expect(
          (adminResult.content as { type: string; text: string }[])[0].text,
        ).toBe('Reflector guard tool executed');
        await adminClient.close();

        const userClient = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });
        const userResult: any = await userClient.callTool({
          name: 'reflector-guard-tool',
          arguments: {},
        });
        expect(userResult.isError).toBe(true);
        await userClient.close();
      });

      it('should pass arguments correctly to guarded tools', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const result = await client.callTool({
          name: 'guarded-with-args',
          arguments: { message: 'hello world' },
        });

        expect(
          (result.content as { type: string; text: string }[])[0].text,
        ).toBe('Echo: hello world');

        await client.close();
      });
    });

    describe('Guard access to tool arguments (RPC payload)', () => {
      it('should list ownership-guarded tool', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const tools = await client.listTools();
        const toolNames = tools.tools.map((t) => t.name);
        expect(toolNames).toContain('ownership-tool');

        await client.close();
      });

      it('should allow execution when user owns the entity', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const result = await client.callTool({
          name: 'ownership-tool',
          arguments: { ownerId: 'user-1', title: 'My Recipe' },
        });

        expect(
          (result.content as { type: string; text: string }[])[0].text,
        ).toBe('Updated: My Recipe (owner: user-1)');

        await client.close();
      });

      it('should deny execution when user does not own the entity', async () => {
        const client = await createClient(testPort, {
          Authorization: 'Bearer user-token',
        });

        const result: any = await client.callTool({
          name: 'ownership-tool',
          arguments: { ownerId: 'someone-else', title: 'Not My Recipe' },
        });
        expect(result.isError).toBe(true);

        await client.close();
      });
    });
  });
});
