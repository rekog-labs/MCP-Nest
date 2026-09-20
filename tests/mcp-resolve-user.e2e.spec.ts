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
 *
 * Because the option hands a hot, security-bearing path to user code, the later
 * blocks pin the edges rather than the happy path: a resolver that throws must
 * deny rather than escape as an unhandled rejection, a resolver that returns a
 * promise must not pass for a principal (a truthy non-principal would read as
 * "authenticated" under `allowUnauthenticatedAccess`), and stdio — which has no
 * request — must never call the resolver at all.
 */
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { InsufficientScopeError } from '@modelcontextprotocol/client';
import {
  McpController,
  McpServerOptions,
  PublicTool,
  StreamableHttpTransport,
  Tool,
  ToolRoles,
  ToolScopes,
} from '@rekog/mcp-nest';
import {
  bootstrapMcpApp,
  createEraClient,
  createStdioClient,
  ERAS,
} from './utils';

const SCOPE_READ = 'reports:read';
const SCOPE_WRITE = 'reports:write';
const ROLE_ADMIN = 'admin';

const CLAIMS_BY_TOKEN: Record<string, Record<string, unknown>> = {
  'read-token': { scopes: [SCOPE_READ], roles: ['user'] },
  'write-token': {
    scopes: [SCOPE_READ, SCOPE_WRITE],
    roles: ['user', ROLE_ADMIN],
  },
  // The OAuth 2.0 shape every real JWT uses: one space-delimited `scope` string
  // rather than a `scopes` array.
  'scope-string-token': {
    sub: 'auth0|42',
    scope: `${SCOPE_READ} ${SCOPE_WRITE}`,
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

    it('reads a space-delimited `scope` string, not only a `scopes` array', async () => {
      const client = await createEraClient(
        era,
        port,
        bearer('scope-string-token'),
      );
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      // Both scopes, no roles — so the two scoped tools and not the role one.
      expect(names).toEqual(['read-reports', 'write-reports']);
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

/**
 * A resolver written the way a user writes one on the first try: no `?.`, because
 * the middleware "always" runs. On a tokenless request it throws.
 *
 * It must not escape as an unhandled rejection. On the step-up route the call
 * happens pre-dispatch, outside `handlePost`'s `try`, and the self-mounted route
 * does not await the promise it returns — so a throw there would answer nothing
 * at all and could take the process down. It has to read as "no principal".
 */
const throwingResolveUser = (rawRequest: unknown) =>
  (rawRequest as { auth: { payload: Record<string, unknown> } }).auth.payload;

describe.each(ERAS)(
  'resolveUser that throws: the caller is anonymous, not a crash (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;
    const unhandled: unknown[] = [];
    const collectUnhandled = (reason: unknown) => unhandled.push(reason);

    beforeAll(async () => {
      process.on('unhandledRejection', collectUnhandled);
      ({ app, port } = await bootstrapMcpApp({
        name: 'test-resolve-user-throws',
        controllers: [ReportTools],
        resolveUser: throwingResolveUser,
        // Step-up on purpose: its pre-dispatch check is the one call site that
        // sits outside the transport's error handling.
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
      process.off('unhandledRejection', collectUnhandled);
      await app.close();
    });

    it('denies a tokenless tools/call instead of hanging', async () => {
      const client = await createEraClient(era, port);

      expect((await client.listTools()).tools).toEqual([]);
      await expect(
        client.callTool({ name: 'write-reports', arguments: {} }),
      ).rejects.toThrow(/requires authentication/);
      expect(unhandled).toEqual([]);

      await client.close();
    });

    it('still serves the next caller', async () => {
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

@McpController()
class FreemiumTools {
  @Tool({ name: 'teaser', description: 'Free for anyone' })
  @PublicTool()
  async teaser() {
    return { content: [{ type: 'text', text: 'teaser' }] };
  }

  @Tool({ name: 'plain-report', description: 'Any authenticated caller' })
  async plainReport() {
    return { content: [{ type: 'text', text: 'plain' }] };
  }
}

describe.each(ERAS)(
  'resolveUser with allowUnauthenticatedAccess (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      ({ app, port } = await bootstrapMcpApp({
        name: 'test-resolve-user-freemium',
        controllers: [FreemiumTools],
        allowUnauthenticatedAccess: true,
        resolveUser,
        configure: (nestApp) => {
          nestApp.use(authPayloadMiddleware);
        },
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('gives an anonymous caller the public tool only', async () => {
      const client = await createEraClient(era, port);
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
        'teaser',
      ]);
      await expect(
        client.callTool({ name: 'plain-report', arguments: {} }),
      ).rejects.toThrow(/requires authentication/);
      await client.close();
    });

    it('opens the undecorated tool once the resolver yields a principal', async () => {
      const client = await createEraClient(era, port, bearer('read-token'));
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(['plain-report', 'teaser']);
      const result: any = await client.callTool({
        name: 'plain-report',
        arguments: {},
      });
      expect(result.content[0].text).toBe('plain');
      await client.close();
    });
  },
);

/**
 * An `async` resolver is a type error, so this one is cast past the types — the
 * only way it can reach the strategy. It must not be mistaken for a principal:
 * a promise is truthy, and freemium mode decides on `!user`, so a truthy
 * non-principal would read as "authenticated" and open every undecorated tool.
 */
const promiseResolveUser = ((rawRequest: unknown) =>
  Promise.resolve(
    (rawRequest as { auth?: { payload?: Record<string, unknown> } }).auth
      ?.payload,
  )) as unknown as McpServerOptions['resolveUser'];

describe.each(ERAS)(
  'resolveUser that returns a promise: refused, not trusted (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      ({ app, port } = await bootstrapMcpApp({
        name: 'test-resolve-user-promise',
        controllers: [FreemiumTools],
        allowUnauthenticatedAccess: true,
        resolveUser: promiseResolveUser,
        configure: (nestApp) => {
          nestApp.use(authPayloadMiddleware);
        },
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it('does not let a thenable authenticate the caller', async () => {
      // The claims are there and the promise would resolve to them — but nothing
      // may be judged on a value that has not settled.
      const client = await createEraClient(era, port, bearer('write-token'));
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
        'teaser',
      ]);
      await expect(
        client.callTool({ name: 'plain-report', arguments: {} }),
      ).rejects.toThrow(/requires authentication/);
      await client.close();
    });
  },
);

describe('resolveUser on stdio: there is no request, so it is never called', () => {
  it('leaves the resolver alone and yields no principal', async () => {
    const client = await createStdioClient({
      serverScriptPath: join(
        __dirname,
        'fixtures',
        'stdio-resolve-user-server.ts',
      ),
    });

    // The scoped tool stays hidden: no request means no principal, whatever the
    // resolver would have returned.
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(['resolver-calls']);

    const result = (await client.callTool({
      name: 'resolver-calls',
      arguments: {},
    })) as { content: Array<{ text: string }> };
    expect(JSON.parse(result.content[0].text)).toEqual({ resolverCalls: 0 });

    await client.close();
  });
});
