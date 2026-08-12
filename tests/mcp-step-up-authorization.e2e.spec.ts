/**
 * Step-up authorization — the two `WWW-Authenticate` obligations in the MCP
 * authorization spec that per-tool authorization did not meet.
 *
 * 1. **`scope` on the 401 challenge** (unconditional). "MCP servers SHOULD
 *    include a `scope` parameter in the `WWW-Authenticate` header … to indicate
 *    the scopes required for accessing the resource." `McpAuthJwtGuard` emitted
 *    only `resource_metadata`.
 *
 * 2. **`403` + `error="insufficient_scope"` for a scope-deficient `tools/call`**
 *    (opt-in via `stepUpAuthorization`). "If the request lacks the necessary
 *    scope, the server SHOULD respond with `HTTP 403 Forbidden` … `scope="…"` …
 *    `resource_metadata="…"`." Without it a `@ToolScopes()` denial travels as a
 *    JSON-RPC error inside an HTTP 200, and since `WWW-Authenticate` is bound to
 *    an HTTP status a conforming client never learns which scopes to ask for —
 *    step-up can never trigger.
 *
 * Why (2) is off by default: the spec text is a SHOULD, and flipping it changes
 * what *existing* clients see for a denial (a transport-level 403 instead of a
 * tool-level JSON-RPC error). `e2e/per-tool-authorization*.test.ts` — the repo's
 * backward-compatibility gate, driven by a pinned OLD client — asserts the
 * JSON-RPC form, so the default has to stay as it is. The last describe block
 * here is the regression guard for that default.
 *
 * The check is **pre-dispatch**, in `StreamableHttpTransport.handlePost`: by the
 * time the tool-level decision is normally made the HTTP status is settled (on
 * the modern era `createMcpHandler` owns response writing outright). It reads the
 * already-parsed body, before the era is chosen — hence the era-parameterised
 * blocks below run the same wire assertions on both legs, and the SDK client
 * tests prove the challenge round-trips through the client's own parser.
 */
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  INestApplication,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { InsufficientScopeError } from '@modelcontextprotocol/client';
import {
  MCP_RESOURCE_METADATA_URL,
  McpController,
  McpHttpControllerFor,
  McpStrategy,
  PublicTool,
  StreamableHttpTransport,
  Tool,
  ToolRoles,
  ToolScopes,
} from '@rekog/mcp-nest';
import {
  JwtTokenService,
  McpAuthJwtGuard,
  McpAuthModule,
  MemoryStore,
} from '@rekog/mcp-nest-auth';
import type {
  OAuthProviderConfig,
  OAuthUserProfile,
} from '@rekog/mcp-nest-auth';
import {
  bootstrapMcpApp,
  createEraClient,
  ERAS,
  Era,
  MODERN_PROTOCOL_VERSION,
} from './utils';

/** Both scopes the guarded tool declares — the challenge must name both. */
const SCOPE_READ = 'reports:read';
const SCOPE_WRITE = 'reports:write';
/** Where a bring-your-own guard says this resource's metadata document lives. */
const GUARD_METADATA_URL =
  'https://guard.example.com/.well-known/oauth-protected-resource';

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

@McpController()
class ScopedTools {
  @Tool({
    name: 'read-reports',
    description: 'Needs two scopes',
    parameters: z.object({}),
  })
  @ToolScopes([SCOPE_READ, SCOPE_WRITE])
  readReports() {
    return { content: [{ type: 'text', text: 'reports' }] };
  }

  @Tool({
    name: 'read-reports-any',
    description: 'Needs either of two scopes',
    parameters: z.object({}),
  })
  @ToolScopes([SCOPE_READ, SCOPE_WRITE], { match: 'any' })
  readReportsAny() {
    return { content: [{ type: 'text', text: 'reports (any)' }] };
  }

  @Tool({
    name: 'admin-reports',
    description: 'Needs a role, not a scope',
    parameters: z.object({}),
  })
  @ToolRoles(['admin'])
  adminReports() {
    return { content: [{ type: 'text', text: 'admin reports' }] };
  }

  @Tool({
    name: 'public-reports',
    description: 'Needs nothing',
    parameters: z.object({}),
  })
  @PublicTool()
  publicReports() {
    return { content: [{ type: 'text', text: 'public reports' }] };
  }
}

// ---------------------------------------------------------------------------
// A bring-your-own authentication guard (i.e. not @rekog/mcp-nest-auth)
// ---------------------------------------------------------------------------

function resolveUser(authHeader?: string): Record<string, unknown> | undefined {
  if (authHeader?.includes('read-token')) {
    return { sub: 'reader', scope: SCOPE_READ };
  }
  if (authHeader?.includes('full-token')) {
    return { sub: 'writer', scope: `${SCOPE_READ} ${SCOPE_WRITE}` };
  }
  if (authHeader?.includes('roleless-token')) {
    return { sub: 'roleless', scope: '', roles: [] };
  }
  return undefined;
}

/**
 * Resolves `req.user` and publishes the protected-resource-metadata URL the way
 * `McpAuthJwtGuard` does — proving the transport reads the slot rather than
 * anything specific to the auth package.
 */
@Injectable()
class IdentityGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<any>();
    req.user = resolveUser(req.headers?.authorization);
    req[MCP_RESOURCE_METADATA_URL] = GUARD_METADATA_URL;
    return true;
  }
}

/** Same, minus the metadata URL: the challenge must then omit `resource_metadata`. */
@Injectable()
class IdentityGuardWithoutMetadata implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<any>();
    req.user = resolveUser(req.headers?.authorization);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Raw-wire helpers — the status code and the header are the whole point here, so
// these assertions cannot go through the SDK client.
// ---------------------------------------------------------------------------

interface RawResult {
  status: number;
  challenge: string | null;
  json: any;
}

/**
 * A `tools/call` POST shaped for one era. Modern requests carry the
 * `2026-07-28` envelope in `params._meta` plus the SEP-2243 `Mcp-Method` /
 * `Mcp-Name` headers; legacy requests carry neither.
 */
async function rawToolCall(
  port: number,
  era: Era,
  options: { tool: string; token?: string; id?: number | string } = {
    tool: 'read-reports',
  },
): Promise<RawResult> {
  const id = options.id ?? 42;
  const modern = era === 'modern';
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': modern ? MODERN_PROTOCOL_VERSION : '2025-06-18',
      ...(modern
        ? { 'Mcp-Method': 'tools/call', 'Mcp-Name': options.tool }
        : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name: options.tool,
        arguments: {},
        ...(modern
          ? {
              _meta: {
                'io.modelcontextprotocol/protocolVersion':
                  MODERN_PROTOCOL_VERSION,
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            }
          : {}),
      },
    }),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return {
    status: res.status,
    challenge: res.headers.get('www-authenticate'),
    json,
  };
}

/**
 * Parse a `WWW-Authenticate: Bearer k="v", …` value into its parameters. Written
 * out rather than reusing the SDK client's extractor so the *format* is asserted
 * here; the client tests below prove the SDK itself accepts it.
 */
function challengeParams(header: string | null): Record<string, string> {
  expect(header).toBeTruthy();
  expect(header!.startsWith('Bearer ')).toBe(true);
  const params: Record<string, string> = {};
  for (const [, key, value] of header!.matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) {
    params[key] = value.replace(/\\(.)/g, '$1');
  }
  return params;
}

// ---------------------------------------------------------------------------
// Harness: a BYO-guard server, with the option in the requested state
// ---------------------------------------------------------------------------

async function bootstrapGuarded(config: {
  stepUpAuthorization?: boolean | { resourceMetadataUrl?: string };
  publishMetadataUrl?: boolean;
  /**
   * Stateless by default so a raw legacy `tools/call` needs no `initialize`
   * handshake and no `mcp-session-id`. The pre-dispatch check runs before the
   * session split, so both modes take the identical path — the SDK-client block
   * below runs the stateful one to keep that covered.
   */
  statefulMode?: boolean;
}): Promise<{ app: INestApplication; port: number }> {
  const transport = new StreamableHttpTransport({
    statefulMode: config.statefulMode ?? false,
    ...(config.stepUpAuthorization !== undefined
      ? { stepUpAuthorization: config.stepUpAuthorization }
      : {}),
  });
  const guard =
    config.publishMetadataUrl === false
      ? IdentityGuardWithoutMetadata
      : IdentityGuard;

  @Controller('mcp')
  @UseGuards(guard)
  class GuardedMcpController extends McpHttpControllerFor(transport) {}

  const { app, port } = await bootstrapMcpApp({
    name: 'step-up-server',
    controllers: [ScopedTools, GuardedMcpController],
    providers: [guard],
    transports: [transport],
  });
  return { app, port };
}

describe.each(ERAS)(
  'Step-up authorization: 403 insufficient_scope (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      ({ app, port } = await bootstrapGuarded({ stepUpAuthorization: true }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('answers a scope-deficient tools/call with 403', async () => {
      const res = await rawToolCall(port, era, {
        tool: 'read-reports',
        token: 'read-token',
      });
      expect(res.status).toBe(403);
    });

    it('challenges with error="insufficient_scope" and every required scope', async () => {
      const res = await rawToolCall(port, era, {
        tool: 'read-reports',
        token: 'read-token',
      });
      const params = challengeParams(res.challenge);

      expect(params.error).toBe('insufficient_scope');
      // Space-delimited, and the *required* set (not just the missing one) —
      // that is the value the client hands to /authorize, and the spec's own
      // example is `scope="required_scope1 required_scope2"`.
      expect(params.scope).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
      expect(params.error_description).toContain('read-reports');
    });

    it('points at the resource metadata the authentication layer published', async () => {
      const res = await rawToolCall(port, era, {
        tool: 'read-reports',
        token: 'read-token',
      });
      expect(challengeParams(res.challenge).resource_metadata).toBe(
        GUARD_METADATA_URL,
      );
    });

    it('answers the 403 with a well-formed JSON-RPC error carrying the request id', async () => {
      // An empty or unrecognized body on a non-200 makes a conforming client
      // conclude the server is legacy and retry `initialize`. The id is echoed
      // (unlike the header-validation 403, which has no parsed body) so the
      // client can correlate the failure with its own call.
      const res = await rawToolCall(port, era, {
        tool: 'read-reports',
        token: 'read-token',
        id: 'call-7',
      });
      expect(res.json.jsonrpc).toBe('2.0');
      expect(res.json.id).toBe('call-7');
      expect(typeof res.json.error.code).toBe('number');
      expect(res.json.error.message).toContain(SCOPE_READ);
      expect(res.json.error.message).toContain(SCOPE_WRITE);
      expect(res.json.result).toBeUndefined();
    });

    it('does not challenge a caller who holds every required scope', async () => {
      const res = await rawToolCall(port, era, {
        tool: 'read-reports',
        token: 'full-token',
      });
      expect(res.status).toBe(200);
      expect(res.challenge).toBeNull();
    });

    it('does not challenge an any-scope tool when the caller holds one of the scopes', async () => {
      // read-token only carries SCOPE_READ, but `match: 'any'` is satisfied by
      // holding just one of the two listed scopes — no step-up, call succeeds.
      const res = await rawToolCall(port, era, {
        tool: 'read-reports-any',
        token: 'read-token',
      });
      expect(res.status).toBe(200);
      expect(res.challenge).toBeNull();
      expect(res.json.result).toBeDefined();
    });

    it('challenges an any-scope tool with error="insufficient_scope" when the caller holds none', async () => {
      const res = await rawToolCall(port, era, {
        tool: 'read-reports-any',
        token: 'roleless-token',
      });
      const params = challengeParams(res.challenge);

      expect(res.status).toBe(403);
      expect(params.error).toBe('insufficient_scope');
      // Both scopes are advertised — obtaining either one would satisfy the tool.
      expect(params.scope).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
      expect(res.json.error.message).toContain('requires any of scopes');
      expect(res.json.error.message).toContain(SCOPE_READ);
      expect(res.json.error.message).toContain(SCOPE_WRITE);
    });

    it('does not challenge a @PublicTool() call', async () => {
      const res = await rawToolCall(port, era, {
        tool: 'public-reports',
        token: 'read-token',
      });
      expect(res.status).toBe(200);
      expect(res.challenge).toBeNull();
    });

    it('does not challenge a @ToolRoles() failure', async () => {
      // Roles are not scopes: there is no scope to name in the challenge and no
      // authorization request that would fix the denial, so a role failure keeps
      // the JSON-RPC error it has always produced.
      const res = await rawToolCall(port, era, {
        tool: 'admin-reports',
        token: 'roleless-token',
      });
      expect(res.status).toBe(200);
      expect(res.challenge).toBeNull();
      expect(res.json.error.message).toContain('requires roles');
    });

    it('does not challenge an unknown tool', async () => {
      // It has to reach the handler to get its -32602; a 403 would tell the
      // client to go and buy scopes for a tool that does not exist.
      const res = await rawToolCall(port, era, {
        tool: 'no-such-tool',
        token: 'read-token',
      });
      expect(res.status).toBe(200);
      expect(res.challenge).toBeNull();
      expect(res.json.error.code).toBe(-32602);
    });

    it('does not challenge a tools/list', async () => {
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: 'Bearer read-token',
          'MCP-Protocol-Version':
            era === 'modern' ? MODERN_PROTOCOL_VERSION : '2025-06-18',
          ...(era === 'modern' ? { 'Mcp-Method': 'tools/list' } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params:
            era === 'modern'
              ? {
                  _meta: {
                    'io.modelcontextprotocol/protocolVersion':
                      MODERN_PROTOCOL_VERSION,
                    'io.modelcontextprotocol/clientCapabilities': {},
                  },
                }
              : {},
        }),
      });
      expect(res.headers.get('www-authenticate')).toBeNull();
    });
  },
);

describe.each(ERAS)(
  'Step-up authorization: the SDK client acts on the challenge (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      ({ app, port } = await bootstrapGuarded({
        stepUpAuthorization: true,
        statefulMode: true,
      }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('surfaces InsufficientScopeError with the challenged scopes', async () => {
      // The end-to-end proof that step-up is now reachable: the SDK client
      // recognises the 403, parses the challenge with its own extractor, and —
      // having no OAuthClientProvider to drive re-authorization with — hands the
      // parameters to the host. Before this change the same call resolved to a
      // JSON-RPC error and no client could ever get here.
      const client = await createEraClient(era, port, {
        requestInit: { headers: { Authorization: 'Bearer read-token' } },
      });

      let error: unknown;
      try {
        await client.callTool({ name: 'read-reports', arguments: {} });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(InsufficientScopeError);
      const insufficient = error as InsufficientScopeError;
      expect(insufficient.requiredScope).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
      expect(insufficient.resourceMetadataUrl?.href).toBe(GUARD_METADATA_URL);

      await client.close().catch(() => {});
    });

    it('still serves a sufficiently-scoped call on the same server', async () => {
      const client = await createEraClient(era, port, {
        requestInit: { headers: { Authorization: 'Bearer full-token' } },
      });

      const result = await client.callTool({
        name: 'read-reports',
        arguments: {},
      });
      expect((result.content as { text: string }[])[0].text).toBe('reports');

      await client.close();
    });
  },
);

describe('Step-up authorization: resource_metadata sources', () => {
  it('prefers the explicitly configured URL over the one on the request', async () => {
    const configured = 'https://configured.example.com/.well-known/prm';
    const { app, port } = await bootstrapGuarded({
      stepUpAuthorization: { resourceMetadataUrl: configured },
    });

    const res = await rawToolCall(port, 'modern', {
      tool: 'read-reports',
      token: 'read-token',
    });
    expect(challengeParams(res.challenge).resource_metadata).toBe(configured);

    await app.close();
  });

  it('omits resource_metadata when nothing published one', async () => {
    // Core cannot derive the URL — it does not know the deployment's canonical
    // serverUrl, nor whether the metadata endpoint is served at all — and a
    // guessed URL would just send clients to a 404. `error` and `scope`, the
    // parameters step-up actually turns on, still go out.
    const { app, port } = await bootstrapGuarded({
      stepUpAuthorization: true,
      publishMetadataUrl: false,
    });

    const res = await rawToolCall(port, 'modern', {
      tool: 'read-reports',
      token: 'read-token',
    });
    const params = challengeParams(res.challenge);
    expect(res.status).toBe(403);
    expect(params.error).toBe('insufficient_scope');
    expect(params.scope).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
    expect(params.resource_metadata).toBeUndefined();

    await app.close();
  });
});

describe.each(ERAS)(
  'Step-up authorization: a self-mounted route has no user to judge (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      // Self-mounted routes are registered straight on the HTTP adapter, OUTSIDE
      // Nest's routing pipeline, so no guard runs and there is no `req.user`.
      // The option is honest about that: with no principal there is nothing to
      // compare scopes against, so nothing is challenged and the pre-existing
      // "requires authentication" JSON-RPC denial stands. Inventing an
      // authentication requirement here is not the transport's job.
      ({ app, port } = await bootstrapMcpApp({
        name: 'step-up-self-mounted',
        controllers: [ScopedTools],
        transports: [
          new StreamableHttpTransport({ stepUpAuthorization: true }),
        ],
      }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('denies without a challenge when there is no authenticated user', async () => {
      const res = await rawToolCall(port, era, { tool: 'read-reports' });
      expect(res.status).not.toBe(403);
      expect(res.challenge).toBeNull();
    });
  },
);

describe.each(ERAS)(
  'Step-up authorization: OFF by default — nothing changes (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      // No `stepUpAuthorization` at all: this is the configuration every
      // existing deployment and the whole `e2e/` backward-compatibility suite
      // runs, so it must behave exactly as before.
      ({ app, port } = await bootstrapGuarded({}));
    });
    afterAll(async () => {
      await app.close();
    });

    it('denies a scope-deficient call with a JSON-RPC error inside HTTP 200', async () => {
      const res = await rawToolCall(port, era, {
        tool: 'read-reports',
        token: 'read-token',
      });
      expect(res.status).toBe(200);
      expect(res.json.error.message).toContain('requires scopes');
    });

    it('sends no WWW-Authenticate header', async () => {
      const res = await rawToolCall(port, era, {
        tool: 'read-reports',
        token: 'read-token',
      });
      expect(res.challenge).toBeNull();
    });

    it('makes the SDK client reject with the JSON-RPC error, not InsufficientScopeError', async () => {
      // The shape `e2e/per-tool-authorization*.test.ts` asserts with a pinned
      // OLD client. A JSON-RPC rejection also proves the response was a 200 —
      // any 4xx would surface as an HTTP-level SDK error instead.
      const client = await createEraClient(era, port, {
        requestInit: { headers: { Authorization: 'Bearer read-token' } },
      });

      let error: any;
      try {
        await client.callTool({ name: 'read-reports', arguments: {} });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeDefined();
      expect(error).not.toBeInstanceOf(InsufficientScopeError);
      expect(String(error?.message)).toContain('requires scopes');

      await client.close().catch(() => {});
    });
  },
);

// ---------------------------------------------------------------------------
// The 401 challenge — @rekog/mcp-nest-auth's guard. Not era-parameterised: the
// guard sits in front of the transport and never looks at the protocol revision.
// ---------------------------------------------------------------------------

const AUTH_JWT_SECRET = 'step-up-authorization-test-secret-at-least-32-chars';
const AUTH_SERVER_URL = 'http://localhost:3000';
const AUTH_RESOURCE = `${AUTH_SERVER_URL}/mcp`;

const MockProvider: OAuthProviderConfig = {
  name: 'mock',
  displayName: 'Mock Provider',
  strategy: class MockStrategy {
    name = 'mock';
    constructor(_options: any, _verify: any) {}
    authenticate(this: any) {
      this.redirect('https://mock-idp.example/authorize');
    }
  },
  strategyOptions: (options) => ({
    clientID: options.clientId,
    clientSecret: options.clientSecret,
    callbackURL: `${options.serverUrl}${options.callbackPath}`,
  }),
  profileMapper: (profile: any): OAuthUserProfile => ({
    id: profile.id,
    username: profile.username,
  }),
};

describe('Step-up authorization: the built-in authorization server', () => {
  let app: INestApplication;
  let port: number;
  let jwtTokenService: JwtTokenService;

  beforeAll(async () => {
    const transport = new StreamableHttpTransport({
      statefulMode: true,
      stepUpAuthorization: true,
    });

    @Controller('mcp')
    @UseGuards(McpAuthJwtGuard)
    class GuardedMcpController extends McpHttpControllerFor(transport) {}

    const strategy = new McpStrategy({
      name: 'step-up-oauth-server',
      version: '0.0.1',
      transports: [transport],
    });

    const moduleFixture = await Test.createTestingModule({
      imports: [
        McpAuthModule.forRoot({
          provider: MockProvider,
          clientId: 'mock-client-id',
          clientSecret: 'mock-client-secret',
          jwtSecret: AUTH_JWT_SECRET,
          serverUrl: AUTH_SERVER_URL,
          resource: AUTH_RESOURCE,
          apiPrefix: 'auth',
          cookieSecure: false,
          // Configured explicitly, so the assertions below are about *this*
          // value rather than whatever the module's default list happens to be.
          protectedResourceMetadata: {
            scopesSupported: [SCOPE_READ, SCOPE_WRITE],
          },
          storeConfiguration: { type: 'custom', store: new MemoryStore() },
        }),
      ],
      controllers: [ScopedTools, GuardedMcpController],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    strategy.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy });
    await app.startAllMicroservices();
    await app.listen(0);
    port = (app.getHttpServer().address() as { port: number }).port;
    jwtTokenService = app.get(JwtTokenService, { strict: false });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('401 challenge', () => {
    it('names the scopes required for the resource', async () => {
      const res = await rawToolCall(port, 'modern', { tool: 'read-reports' });
      expect(res.status).toBe(401);

      const scopes = challengeParams(res.challenge).scope.split(' ');
      // Membership, not equality: the resolved list is the module's business and
      // may legitimately carry more (or fewer) entries than were configured.
      expect(scopes).toContain(SCOPE_READ);
      expect(scopes).toContain(SCOPE_WRITE);
    });

    it('still carries resource_metadata (RFC 9728 discovery)', async () => {
      const res = await rawToolCall(port, 'modern', { tool: 'read-reports' });
      expect(challengeParams(res.challenge).resource_metadata).toBe(
        `${AUTH_SERVER_URL}/.well-known/oauth-protected-resource`,
      );
    });

    it('challenges an invalid token the same way', async () => {
      const res = await rawToolCall(port, 'modern', {
        tool: 'read-reports',
        token: 'not-a-jwt',
      });
      expect(res.status).toBe(401);
      const params = challengeParams(res.challenge);
      expect(params.scope.split(' ')).toContain(SCOPE_READ);
      expect(params.resource_metadata).toBeTruthy();
    });

    it('is parseable by the SDK client', async () => {
      // The header is only useful if the client's own parser accepts it: it
      // splits on the first space and requires a `Bearer <params>` shape.
      const res = await fetch(`http://localhost:${port}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      const { extractWWWAuthenticateParams } = await import(
        '@modelcontextprotocol/client'
      );
      const parsed = extractWWWAuthenticateParams(res);
      expect(parsed.resourceMetadataUrl?.href).toBe(
        `${AUTH_SERVER_URL}/.well-known/oauth-protected-resource`,
      );
      expect(parsed.scope?.split(' ')).toContain(SCOPE_READ);
    });
  });

  describe('403 challenge', () => {
    it('challenges a real access token that is short on scope', async () => {
      // The full stack: a token this authorization server actually minted,
      // audienced and typed correctly, so the guard admits it — and only then
      // does per-tool authorization find it one scope short.
      const { access_token } = jwtTokenService.generateTokenPair(
        'reader',
        'mock-client-id',
        SCOPE_READ,
        AUTH_RESOURCE,
      );

      const res = await rawToolCall(port, 'modern', {
        tool: 'read-reports',
        token: access_token,
      });
      const params = challengeParams(res.challenge);

      expect(res.status).toBe(403);
      expect(params.error).toBe('insufficient_scope');
      expect(params.scope).toBe(`${SCOPE_READ} ${SCOPE_WRITE}`);
      // Published by McpAuthJwtGuard from the module's own serverUrl — no
      // transport option needed for the built-in authorization server.
      expect(params.resource_metadata).toBe(
        `${AUTH_SERVER_URL}/.well-known/oauth-protected-resource`,
      );
    });

    it('serves the call once the token carries both scopes', async () => {
      const { access_token } = jwtTokenService.generateTokenPair(
        'writer',
        'mock-client-id',
        `${SCOPE_READ} ${SCOPE_WRITE}`,
        AUTH_RESOURCE,
      );

      const res = await rawToolCall(port, 'modern', {
        tool: 'read-reports',
        token: access_token,
      });
      expect(res.status).toBe(200);
      expect(res.challenge).toBeNull();
    });
  });
});
