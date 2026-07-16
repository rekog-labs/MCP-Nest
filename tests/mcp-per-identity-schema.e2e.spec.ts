import {
  CanActivate,
  ExecutionContext,
  INestApplication,
  Injectable,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import {
  McpTransportType,
  PublicTool,
  Tool,
  ToolGuards,
  ToolSchemaContext,
} from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { createStreamableClient } from './utils';

/**
 * Per-identity tool schema resolution.
 *
 * Verifies that a tool's `parameters` may be a `(ctx) => z.ZodType` resolver
 * evaluated per identity, that the schema advertised at `tools/list` is the
 * SAME schema used to validate `tools/call`, that plain Zod schemas are
 * unaffected (byte-identical across identities), and that `@ToolGuards()` still
 * run BEFORE schema validation.
 */

/** Transport-level guard: maps a bearer token to a user with a role. */
@Injectable()
class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers?.authorization;
    if (authHeader?.includes('admin-token')) {
      request.user = { id: 'admin-1', role: 'admin' };
    } else if (authHeader?.includes('user-token')) {
      request.user = { id: 'user-1', role: 'user' };
    }
    return true; // allow through; per-tool guards handle authorization
  }
}

/** Denies everyone — used to prove guards run before schema validation. */
@Injectable()
class DenyGuard implements CanActivate {
  canActivate(): boolean {
    return false;
  }
}

const isAdmin = (ctx: ToolSchemaContext): boolean =>
  (ctx.user as { role?: string } | undefined)?.role === 'admin';

/**
 * Example resolver: admins must supply `tenantId`; everyone else sees the base
 * schema unchanged.
 */
const tenantScopedCreate = (ctx: ToolSchemaContext): z.ZodType =>
  isAdmin(ctx)
    ? z.object({ name: z.string(), tenantId: z.string() })
    : z.object({ name: z.string() });

@Injectable()
class PerIdentityTools {
  @Tool({
    name: 'static-tool',
    description: 'Plain static schema — must be identical for every identity',
    parameters: z.object({ q: z.string() }),
  })
  @PublicTool()
  async staticTool({ q }: { q: string }) {
    return { content: [{ type: 'text', text: `q=${q}` }] };
  }

  @Tool({
    name: 'per-identity-tool',
    description: 'Schema depends on the caller identity',
    parameters: tenantScopedCreate,
  })
  @PublicTool()
  async perIdentityTool(args: { name: string; tenantId?: string }) {
    return {
      content: [
        {
          type: 'text',
          text: `created ${args.name}${
            args.tenantId ? ` in tenant ${args.tenantId}` : ''
          }`,
        },
      ],
    };
  }

  @Tool({
    name: 'always-deny-tool',
    description: 'Guarded tool whose resolver would reject empty args',
    parameters: tenantScopedCreate,
  })
  @ToolGuards([DenyGuard])
  async alwaysDenyTool() {
    return { content: [{ type: 'text', text: 'should never execute' }] };
  }
}

describe('E2E: per-identity tool schema resolution', () => {
  let app: INestApplication;
  let testPort: number;

  const clientFor = (token?: string) =>
    createStreamableClient(
      testPort,
      token
        ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } }
        : {},
    );

  const listTool = async (token: string | undefined, name: string) => {
    const client = await clientFor(token);
    try {
      const { tools } = await client.listTools();
      return tools.find((t) => t.name === name);
    } finally {
      await client.close();
    }
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-per-identity-server',
          version: '0.0.1',
          transport: McpTransportType.STREAMABLE_HTTP,
          guards: [MockAuthGuard],
          allowUnauthenticatedAccess: true,
        }),
      ],
      providers: [PerIdentityTools, MockAuthGuard, DenyGuard],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);
    testPort = app.getHttpServer().address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('static schemas are unaffected (byte-identical across identities)', () => {
    it('renders the same inputSchema for admin and non-admin', async () => {
      const adminStatic = await listTool('admin-token', 'static-tool');
      const userStatic = await listTool('user-token', 'static-tool');

      expect(adminStatic?.inputSchema).toBeDefined();
      expect(adminStatic?.inputSchema).toEqual(userStatic?.inputSchema);
      expect(adminStatic?.inputSchema?.required).toContain('q');
    });
  });

  describe('per-identity resolution at tools/list', () => {
    it('requires tenantId for an admin', async () => {
      const tool = await listTool('admin-token', 'per-identity-tool');
      expect(tool?.inputSchema?.properties).toHaveProperty('tenantId');
      expect(tool?.inputSchema?.required).toContain('tenantId');
    });

    it('omits tenantId for a non-admin', async () => {
      const tool = await listTool('user-token', 'per-identity-tool');
      expect(tool?.inputSchema?.properties).not.toHaveProperty('tenantId');
      expect(tool?.inputSchema?.required ?? []).not.toContain('tenantId');
    });
  });

  describe('tools/call validates against the SAME resolved schema', () => {
    it('accepts a non-admin call without tenantId', async () => {
      const client = await clientFor('user-token');
      const result = await client.callTool({
        name: 'per-identity-tool',
        arguments: { name: 'apples' },
      });
      expect(result.isError).toBeFalsy();
      expect((result.content as { text: string }[])[0].text).toBe(
        'created apples',
      );
      await client.close();
    });

    it('rejects an admin call that omits the now-required tenantId', async () => {
      const client = await clientFor('admin-token');
      const result = await client.callTool({
        name: 'per-identity-tool',
        arguments: { name: 'apples' },
      });
      expect(result.isError).toBe(true);
      expect((result.content as { text: string }[])[0].text).toMatch(
        /Invalid parameters.*tenantId/,
      );
      await client.close();
    });

    it('accepts an admin call that includes tenantId', async () => {
      const client = await clientFor('admin-token');
      const result = await client.callTool({
        name: 'per-identity-tool',
        arguments: { name: 'apples', tenantId: '42' },
      });
      expect(result.isError).toBeFalsy();
      expect((result.content as { text: string }[])[0].text).toBe(
        'created apples in tenant 42',
      );
      await client.close();
    });
  });

  describe('guards run before schema validation', () => {
    it('denies via guard (not a validation error) when args would also be invalid', async () => {
      const client = await clientFor('admin-token');
      // Admin schema requires tenantId; omit it. If validation ran first we'd
      // get an `isError` result. Because the guard runs first, the call is
      // rejected outright with an access-denied McpError.
      await expect(
        client.callTool({ name: 'always-deny-tool', arguments: {} }),
      ).rejects.toThrow(/permissions|denied/i);
      await client.close();
    });
  });
});
