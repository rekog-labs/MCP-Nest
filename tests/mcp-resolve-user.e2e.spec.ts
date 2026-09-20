/**
 * `McpServerOptions.resolveUser` — where per-tool authorization reads the
 * caller from.
 *
 * `tools/list` filtering, the `tools/call` denial and the step-up `403` all
 * judge the principal `McpStrategy.getUser()` yields, which used to be
 * `rawRequest.user` and nothing else. Authentication that keeps its claims
 * elsewhere — `express-jwt` ≥ 7 (`req.auth`), `express-oauth2-jwt-bearer`
 * (`req.auth.payload`), a client-credentials token with claims but no user at
 * all — had to copy them onto `req.user`, even where that property already
 * meant something else to the host app.
 *
 * `resolveUser` names the function that yields the principal instead. The
 * middleware below leaves the claims nested under `req.auth.payload`, the Auth0
 * shape — the case a plain property name could not express. Left unset, the
 * strategy keeps reading `rawRequest.user`; the second block pins that.
 */
import { INestApplication } from '@nestjs/common';
import { InsufficientScopeError } from '@modelcontextprotocol/client';
import {
  McpController,
  StreamableHttpTransport,
  Tool,
  ToolRoles,
  ToolScopes,
} from '@rekog/mcp-nest';
import { bootstrapMcpApp, createEraClient, ERAS } from './utils';

const SCOPE_READ = 'reports:read';
const SCOPE_WRITE = 'reports:write';
const ROLE_ADMIN = 'admin';

const CLAIMS_BY_TOKEN: Record<string, { scopes: string[]; roles: string[] }> =
  {
    'read-token': { scopes: [SCOPE_READ], roles: ['user'] },
    'write-token': {
      scopes: [SCOPE_READ, SCOPE_WRITE],
      roles: ['user', ROLE_ADMIN],
    },
  };

/**
 * Authentication that never touches `req.user`: the claims land under
 * `req.auth.payload`, the way `express-oauth2-jwt-bearer` leaves them. A
 * tokenless (or unknown-token) request goes through with no claims at all.
 */
const authPayloadMiddleware = (
  req: { headers: Record<string, string | undefined>; auth?: unknown },
  _res: unknown,
  next: () => void,
) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '');
  const claims = token ? CLAIMS_BY_TOKEN[token] : undefined;
  if (claims) req.auth = { payload: claims };
  next();
};

const resolveUser = (rawRequest: unknown) =>
  (rawRequest as { auth?: { payload?: Record<string, unknown> } }).auth
    ?.payload;

function bearer(token: string) {
  return { requestInit: { headers: { Authorization: `Bearer ${token}` } } };
}

@McpController()
class ReportTools {
  @Tool({ name: 'read-reports', description: 'Read reports' })
  @ToolScopes([SCOPE_READ])
  async readReports() {
    return { content: [{ type: 'text', text: 'reports' }] };
  }

  @Tool({ name: 'write-reports', description: 'Write reports' })
  @ToolScopes([SCOPE_WRITE])
  async writeReports() {
    return { content: [{ type: 'text', text: 'written' }] };
  }

  @Tool({ name: 'purge-reports', description: 'Purge reports (admin only)' })
  @ToolRoles([ROLE_ADMIN])
  async purgeReports() {
    return { content: [{ type: 'text', text: 'purged' }] };
  }
}

describe.each(ERAS)(
  'resolveUser: the principal is read off req.auth.payload (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      ({ app, port } = await bootstrapMcpApp({
        name: 'test-resolve-user',
        controllers: [ReportTools],
        resolveUser,
        configure: (nestApp) => {
          nestApp.use(authPayloadMiddleware);
        },
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('lists only the tools the resolved scopes and roles cover', async () => {
      const client = await createEraClient(era, port, bearer('read-token'));
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(['read-reports']);
      await client.close();
    });

    it('lists every tool once the resolved principal covers it', async () => {
      const client = await createEraClient(era, port, bearer('write-token'));
      const names = (await client.listTools()).tools
        .map((t) => t.name)
        .sort();
      expect(names).toEqual(['purge-reports', 'read-reports', 'write-reports']);
      await client.close();
    });

    it('hides every gated tool when the resolver yields no principal', async () => {
      const client = await createEraClient(era, port);
      expect((await client.listTools()).tools).toEqual([]);
      await client.close();
    });

    it('denies a tools/call the resolved scopes do not cover', async () => {
      const client = await createEraClient(era, port, bearer('read-token'));
      await expect(
        client.callTool({ name: 'write-reports', arguments: {} }),
      ).rejects.toThrow(/requires scopes: reports:write/);
      await client.close();
    });

    it('denies a tools/call the resolved roles do not cover', async () => {
      const client = await createEraClient(era, port, bearer('read-token'));
      await expect(
        client.callTool({ name: 'purge-reports', arguments: {} }),
      ).rejects.toThrow(/requires roles: admin/);
      await client.close();
    });

    it('allows a tools/call the resolved principal covers', async () => {
      const client = await createEraClient(era, port, bearer('write-token'));
      const result: any = await client.callTool({
        name: 'write-reports',
        arguments: {},
      });
      expect(result.content[0].text).toBe('written');
      await client.close();
    });
  },
);

describe.each(ERAS)(
  'resolveUser unset: only rawRequest.user is read (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      // Same middleware, no resolver: the claims under `req.auth.payload` must
      // stay invisible, so the caller who was fully authorized above is an
      // anonymous caller here. (That `req.user` itself still works is what
      // every other per-tool authorization suite asserts.)
      ({ app, port } = await bootstrapMcpApp({
        name: 'test-resolve-user-default',
        controllers: [ReportTools],
        configure: (nestApp) => {
          nestApp.use(authPayloadMiddleware);
        },
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('does not read req.auth', async () => {
      const client = await createEraClient(era, port, bearer('write-token'));
      expect((await client.listTools()).tools).toEqual([]);
      await expect(
        client.callTool({ name: 'write-reports', arguments: {} }),
      ).rejects.toThrow(/requires authentication/);
      await client.close();
    });
  },
);

describe.each(ERAS)(
  'resolveUser: the step-up 403 judges the resolved principal (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      ({ app, port } = await bootstrapMcpApp({
        name: 'test-resolve-user-step-up',
        controllers: [ReportTools],
        resolveUser,
        transports: [
          new StreamableHttpTransport({
            statefulMode: true,
            stepUpAuthorization: true,
          }),
        ],
        configure: (nestApp) => {
          nestApp.use(authPayloadMiddleware);
        },
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('challenges a scope-deficient tools/call with insufficient_scope', async () => {
      // The pre-dispatch check asks the strategy through the same `getUser()`,
      // so it sees the resolved principal too — here on a self-mounted route
      // with plain middleware, where no Nest guard could have set `req.user`.
      const client = await createEraClient(era, port, bearer('read-token'));

      let error: unknown;
      try {
        await client.callTool({ name: 'write-reports', arguments: {} });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(InsufficientScopeError);
      expect((error as InsufficientScopeError).requiredScope).toBe(SCOPE_WRITE);

      await client.close().catch(() => {});
    });

    it('does not challenge a tools/call the resolved scopes cover', async () => {
      const client = await createEraClient(era, port, bearer('write-token'));
      const result: any = await client.callTool({
        name: 'write-reports',
        arguments: {},
      });
      expect(result.content[0].text).toBe('written');
      await client.close();
    });
  },
);
