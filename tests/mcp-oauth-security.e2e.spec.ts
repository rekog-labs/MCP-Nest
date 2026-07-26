/**
 * Authorization-security behaviours of `McpAuthModule` (spec revision
 * `2026-07-28`, §10 Tier 2):
 *
 *  - RFC 8707 §2 token audience/issuer/type validation on the bearer path,
 *  - narrowing of client-requested `scope` to what the server actually declares,
 *  - the RFC 9207 `iss` parameter on authorization responses, and
 *  - the canonical-issuer bootstrap check.
 *
 * NOT parameterised over protocol eras (unlike most specs here): every assertion
 * is on the OAuth handshake or the HTTP guard, both of which sit in front of the
 * MCP transport and are era-independent. The era bridge for authenticated
 * requests is covered by `mcp-modern-era-auth.e2e.spec.ts`, and the full
 * authenticated MCP round-trip by `mcp-oauth-auth.e2e.spec.ts`.
 */
import {
  Controller,
  INestApplication,
  Logger,
  UseGuards,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Payload } from '@nestjs/microservices';
import cookieParser from 'cookie-parser';
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { z } from 'zod';
import {
  McpController,
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
  ToolScopes,
} from '@rekog/mcp-nest';
import {
  JwtTokenService,
  McpAuthJwtGuard,
  McpAuthModule,
  MemoryStore,
} from '@rekog/mcp-nest-auth';
import type {
  OAuthClient,
  OAuthProviderConfig,
  OAuthUserProfile,
  ScopeValidationMode,
} from '@rekog/mcp-nest-auth';

const JWT_SECRET = 'oauth-security-test-secret-at-least-32-characters';
const SERVER_URL = 'http://localhost:3000';
const RESOURCE = `${SERVER_URL}/mcp`;
const OTHER_RESOURCE = `${SERVER_URL}/other/mcp`;
const REDIRECT_URI = 'http://localhost:8080/callback';

/** The one scope this app declares, via `@ToolScopes()` on the tool below. */
const DECLARED_SCOPE = 'reports:read';
/** A scope no tool asks for and no metadata lists — strict mode must drop it. */
const UNDECLARED_SCOPE = 'evil:admin';

/**
 * Passport mock that drives the *whole* handshake, not just the outbound leg:
 * on `/authorize` it bounces to a fake IdP, on `/callback` it completes the
 * login so `processAuthenticationSuccess` (and therefore the `iss` redirect and
 * the authorization code) actually runs.
 */
const MockProvider: OAuthProviderConfig = {
  name: 'mock',
  displayName: 'Mock Provider',
  strategy: class MockStrategy {
    name = 'mock';
    _verify: (at: string, rt: string, profile: any, done: any) => void;

    constructor(_options: any, verify: any) {
      this._verify = verify;
    }

    authenticate(this: any, req: any) {
      if (!String(req.url).includes('/callback')) {
        this.redirect('https://mock-idp.example/authorize');
        return;
      }
      this._verify(
        'provider-access-token',
        'provider-refresh-token',
        {
          id: 'user-1',
          username: 'testuser',
          displayName: 'Test User',
          emails: [{ value: 'testuser@example.com' }],
        },
        (err: any, user: any) => (err ? this.error(err) : this.success(user)),
      );
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
    email: profile.emails?.[0]?.value,
    displayName: profile.displayName,
  }),
};

@McpController()
class ScopedTools {
  @Tool({
    name: 'read-reports',
    description: 'Requires the reports:read scope',
    parameters: z.object({}),
  })
  @ToolScopes([DECLARED_SCOPE])
  readReports(@Payload() _args: unknown) {
    return { content: [{ type: 'text', text: 'reports' }] };
  }
}

interface Harness {
  app: INestApplication;
  store: MemoryStore;
  jwtTokenService: JwtTokenService;
}

async function bootstrap(
  scopeValidation?: ScopeValidationMode,
): Promise<Harness> {
  const store = new MemoryStore();
  const transport = new StreamableHttpTransport({ statefulMode: true });
  const strategy = new McpStrategy({
    name: 'oauth-security-server',
    version: '0.0.1',
    transports: [transport],
  });

  @Controller('mcp')
  @UseGuards(McpAuthJwtGuard)
  class GuardedMcpController extends McpHttpControllerFor(transport) {}

  const moduleFixture = await Test.createTestingModule({
    imports: [
      McpAuthModule.forRoot({
        provider: MockProvider,
        clientId: 'mock-client-id',
        clientSecret: 'mock-client-secret',
        jwtSecret: JWT_SECRET,
        serverUrl: SERVER_URL,
        resource: RESOURCE,
        apiPrefix: 'auth',
        cookieSecure: false,
        ...(scopeValidation ? { scopeValidation } : {}),
        storeConfiguration: { type: 'custom', store },
      }),
    ],
    controllers: [ScopedTools, GuardedMcpController],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(0);

  return {
    app,
    store,
    jwtTokenService: app.get(JwtTokenService, { strict: false }),
  };
}

/** Collapse a `set-cookie` header into something re-sendable as `Cookie`. */
function cookieHeader(response: request.Response): string {
  const raw = response.headers['set-cookie'] as unknown as
    | string[]
    | undefined;
  return (raw ?? []).map((c) => c.split(';')[0]).join('; ');
}

function cookieValue(response: request.Response, name: string): string {
  const raw = response.headers['set-cookie'] as unknown as
    | string[]
    | undefined;
  const match = (raw ?? []).find((c) => c.startsWith(`${name}=`));
  return decodeURIComponent(match!.split(';')[0].slice(name.length + 1));
}

async function registerClient(app: INestApplication): Promise<OAuthClient> {
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      client_name: 'Security Test Client',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  return response.body;
}

/** POST a well-formed but minimal MCP request; we only care about the guard. */
function postMcp(app: INestApplication, token?: string) {
  const req = request(app.getHttpServer())
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'security-spec', version: '0.0.1' },
      },
    });
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

describe('E2E: OAuth authorization security', () => {
  describe('Access token audience / issuer / type validation', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrap();
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('accepts an access token minted for this resource', async () => {
      const { access_token } = harness.jwtTokenService.generateTokenPair(
        'testuser',
        'mock-client-id',
        DECLARED_SCOPE,
        RESOURCE,
      );

      const response = await postMcp(harness.app, access_token);
      expect(response.status).not.toBe(401);
    });

    it('rejects a token whose audience is another resource on the same authorization server', async () => {
      // The same AS, the same secret, the same issuer — only `aud` differs. This
      // is the RFC 8707 confused-deputy case a resource server MUST refuse.
      const { access_token } = harness.jwtTokenService.generateTokenPair(
        'testuser',
        'mock-client-id',
        DECLARED_SCOPE,
        OTHER_RESOURCE,
      );

      await postMcp(harness.app, access_token).expect(401);
    });

    it('rejects a token minted by a foreign issuer', async () => {
      const foreign = jwt.sign(
        {
          sub: 'testuser',
          type: 'access',
          scope: DECLARED_SCOPE,
          resource: RESOURCE,
          aud: RESOURCE,
          iss: 'https://issuer.example',
        },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: '1h' },
      );

      await postMcp(harness.app, foreign).expect(401);
    });

    it('rejects the browser cookie token presented as a bearer token', async () => {
      // `type: 'user'`, `aud: 'mcp-client'` — same signing secret, so before the
      // type/audience checks this authenticated as if it were an access token.
      const userToken = harness.jwtTokenService.generateUserToken('testuser', {
        username: 'testuser',
      });

      await postMcp(harness.app, userToken).expect(401);
    });

    it('rejects a refresh token presented as a bearer token', async () => {
      const { refresh_token } = harness.jwtTokenService.generateTokenPair(
        'testuser',
        'mock-client-id',
        DECLARED_SCOPE,
        RESOURCE,
      );

      await postMcp(harness.app, refresh_token!).expect(401);
    });

    it('rejects a refresh token from another resource at the token endpoint', async () => {
      const { refresh_token } = harness.jwtTokenService.generateTokenPair(
        'testuser',
        'mock-client-id',
        DECLARED_SCOPE,
        OTHER_RESOURCE,
      );

      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({ grant_type: 'refresh_token', refresh_token })
        .expect(400);
    });
  });

  describe('Scope narrowing at /authorize', () => {
    let harness: Harness;
    let client: OAuthClient;

    beforeAll(async () => {
      harness = await bootstrap();
      client = await registerClient(harness.app);
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('drops undeclared scopes and keeps declared ones through code and token', async () => {
      const codeVerifier = randomBytes(32).toString('base64url');
      const codeChallenge = createHash('sha256')
        .update(codeVerifier)
        .digest('base64url');

      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
          state: 'state-narrowing',
          // `reports:read` comes from @ToolScopes, `offline_access` from the
          // module's advertised scopesSupported; `evil:admin` from neither.
          scope: `${DECLARED_SCOPE} offline_access ${UNDECLARED_SCOPE}`,
        })
        .expect(302);

      const session = await harness.store.getOAuthSession(
        cookieValue(authorizeResponse, 'oauth_session'),
      );
      expect(session!.scope).toBe(`${DECLARED_SCOPE} offline_access`);

      // Complete the login so the narrowed scope is recorded on the code too.
      const callbackResponse = await request(harness.app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', cookieHeader(authorizeResponse))
        .query({ code: 'idp-code', state: 'ignored' })
        .expect(302);

      const location = new URL(callbackResponse.headers.location);
      const authCode = location.searchParams.get('code')!;
      expect((await harness.store.getAuthCode(authCode))!.scope).toBe(
        `${DECLARED_SCOPE} offline_access`,
      );

      const tokenResponse = await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code: authCode,
          code_verifier: codeVerifier,
          redirect_uri: REDIRECT_URI,
          client_id: client.client_id,
        })
        .expect(200);

      const payload: any = jwt.verify(
        tokenResponse.body.access_token,
        JWT_SECRET,
      );
      expect(payload.scope).toBe(`${DECLARED_SCOPE} offline_access`);
      expect(payload.aud).toBe(RESOURCE);
      expect(payload.iss).toBe(SERVER_URL);
    });

    it('grants no scope at all when every requested scope is undeclared', async () => {
      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: 'challenge',
          code_challenge_method: 'plain',
          state: 'state-all-dropped',
          scope: `${UNDECLARED_SCOPE} another:bogus`,
        })
        .expect(302);

      const session = await harness.store.getOAuthSession(
        cookieValue(authorizeResponse, 'oauth_session'),
      );
      expect(session!.scope).toBeUndefined();
    });
  });

  describe("Scope narrowing with scopeValidation: 'passthrough'", () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrap('passthrough');
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('mints the requested scope unchanged', async () => {
      const client = await registerClient(harness.app);
      const requested = `${DECLARED_SCOPE} ${UNDECLARED_SCOPE}`;

      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: 'challenge',
          code_challenge_method: 'plain',
          state: 'state-passthrough',
          scope: requested,
        })
        .expect(302);

      const session = await harness.store.getOAuthSession(
        cookieValue(authorizeResponse, 'oauth_session'),
      );
      expect(session!.scope).toBe(requested);
    });
  });

  describe('RFC 9207 iss in authorization responses', () => {
    let harness: Harness;
    let client: OAuthClient;

    beforeAll(async () => {
      harness = await bootstrap();
      client = await registerClient(harness.app);
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('advertises authorization_response_iss_parameter_supported', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.authorization_response_iss_parameter_supported).toBe(
        true,
      );
      expect(response.body.issuer).toBe(SERVER_URL);
    });

    it('includes iss on the success redirect', async () => {
      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: 'challenge',
          code_challenge_method: 'plain',
          state: 'state-success',
        })
        .expect(302);

      const callbackResponse = await request(harness.app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', cookieHeader(authorizeResponse))
        .query({ code: 'idp-code', state: 'ignored' })
        .expect(302);

      const location = new URL(callbackResponse.headers.location);
      expect(location.origin + location.pathname).toBe(REDIRECT_URI);
      expect(location.searchParams.get('code')).toBeTruthy();
      expect(location.searchParams.get('state')).toBe('state-success');
      expect(location.searchParams.get('iss')).toBe(SERVER_URL);
    });

    it('returns a post-validation failure on the redirect URI, with iss', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'token',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          state: 'state-error',
        })
        .expect(302);

      const location = new URL(response.headers.location);
      expect(location.origin + location.pathname).toBe(REDIRECT_URI);
      expect(location.searchParams.get('error')).toBe(
        'unsupported_response_type',
      );
      expect(location.searchParams.get('state')).toBe('state-error');
      expect(location.searchParams.get('iss')).toBe(SERVER_URL);
    });

    it('does NOT redirect a failure that happens before the redirect URI is trusted', async () => {
      // Unknown client: the redirect target is unverified, so RFC 6749 §4.1.2.1
      // forbids bouncing the error there. Stays an HTTP 400.
      await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'token',
          client_id: 'no-such-client',
          redirect_uri: REDIRECT_URI,
          state: 'state-error',
        })
        .expect(400);

      await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'token',
          client_id: client.client_id,
          redirect_uri: 'http://evil.example/callback',
          state: 'state-error',
        })
        .expect(400);
    });
  });

  describe('Strict mode with nothing declared', () => {
    let app: INestApplication;
    let warnSpy: jest.SpyInstance;

    beforeAll(async () => {
      // Spy BEFORE bootstrap — the warning fires from onApplicationBootstrap.
      warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      const moduleFixture = await Test.createTestingModule({
        imports: [
          McpAuthModule.forRoot({
            provider: MockProvider,
            clientId: 'mock-client-id',
            clientSecret: 'mock-client-secret',
            jwtSecret: JWT_SECRET,
            serverUrl: SERVER_URL,
            resource: RESOURCE,
            apiPrefix: 'auth',
            cookieSecure: false,
          }),
        ],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.init();
    });

    afterAll(async () => {
      warnSpy.mockRestore();
      await app.close();
    });

    it('warns that every requested scope will be dropped', () => {
      const messages = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(
        messages.some(
          (m) =>
            m.includes('scopeValidation') && m.includes('declares no scopes'),
        ),
      ).toBe(true);
    });
  });

  describe('Canonical issuer validation', () => {
    const baseOptions = {
      provider: MockProvider,
      clientId: 'mock-client-id',
      clientSecret: 'mock-client-secret',
      jwtSecret: JWT_SECRET,
      resource: RESOURCE,
    };

    it('rejects a jwtIssuer that diverges from serverUrl', () => {
      expect(() =>
        McpAuthModule.forRoot({
          ...baseOptions,
          serverUrl: SERVER_URL,
          jwtIssuer: 'https://issuer.example',
        }),
      ).toThrow(/jwtIssuer/);
    });

    it('treats a trailing slash as the same identifier', () => {
      expect(() =>
        McpAuthModule.forRoot({
          ...baseOptions,
          serverUrl: SERVER_URL,
          jwtIssuer: `${SERVER_URL}/`,
        }),
      ).not.toThrow();
    });
  });
});
