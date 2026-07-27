/**
 * Authorization-security and authorization-conformance behaviours of
 * `McpAuthModule` (spec revision `2026-07-28`, §10 Tier 2 and Tier 3):
 *
 * Tier 2:
 *  - RFC 8707 §2 token audience/issuer/type validation on the bearer path,
 *  - narrowing of client-requested `scope` to what the server actually declares,
 *  - the RFC 9207 `iss` parameter on authorization responses, and
 *  - the canonical-issuer bootstrap check.
 *
 * Tier 3:
 *  - mandatory PKCE with S256 only, plus the `requirePkce: false` escape hatch,
 *  - `offline_access` out of the protected-resource `scopes_supported`,
 *  - `application_type` stored (not enforced) at Dynamic Client Registration,
 *  - `disableEndpoints.register` for deployments without DCR.
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
  OAuthUserModuleOptions,
  OAuthUserProfile,
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

/** Option overrides for {@link bootstrap}; `provider` and friends are fixed. */
type AuthOverrides = Partial<
  Omit<OAuthUserModuleOptions, 'provider' | 'jwtSecret' | 'storeConfiguration'>
>;

async function bootstrap(overrides: AuthOverrides = {}): Promise<Harness> {
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
        ...overrides,
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

/**
 * A conforming PKCE pair. `code_challenge` is mandatory and S256-only as of the
 * `requirePkce` default, so every `/authorize` call in this file needs one even
 * when the assertion under test is about something else.
 */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

/** Collapse a `set-cookie` header into something re-sendable as `Cookie`. */
function cookieHeader(response: request.Response): string {
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => c.split(';')[0]).join('; ');
}

function cookieValue(response: request.Response, name: string): string {
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  const match = (raw ?? []).find((c) => c.startsWith(`${name}=`));
  return decodeURIComponent(match!.split(';')[0].slice(name.length + 1));
}

/** A DCR request with the minimum viable body, plus anything extra. */
function postRegister(
  app: INestApplication,
  extra: Record<string, unknown> = {},
) {
  return request(app.getHttpServer())
    .post('/auth/register')
    .send({
      client_name: 'Security Test Client',
      redirect_uris: [REDIRECT_URI],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...extra,
    });
}

async function registerClient(app: INestApplication): Promise<OAuthClient> {
  const response = await postRegister(app);
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
          code_challenge: pkcePair().challenge,
          code_challenge_method: 'S256',
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
      harness = await bootstrap({ scopeValidation: 'passthrough' });
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
          code_challenge: pkcePair().challenge,
          code_challenge_method: 'S256',
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
          code_challenge: pkcePair().challenge,
          code_challenge_method: 'S256',
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
      // Not incidental: importing McpAuthModule always mounts the handshake
      // routes, so the bootstrap check requires this of every host.
      app.use(cookieParser());
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

  describe('PKCE is required, S256 only', () => {
    let harness: Harness;
    let client: OAuthClient;

    beforeAll(async () => {
      harness = await bootstrap();
      client = await registerClient(harness.app);
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('advertises S256 and nothing else', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      // Not `['plain', 'S256']`: OAuth 2.1 §4.1.1 allows `plain` only where S256
      // is unavailable, and advertising it invites a downgrade.
      expect(response.body.code_challenge_methods_supported).toEqual(['S256']);
    });

    it('rejects a request with no code_challenge, on the redirect URI', async () => {
      // A post-validation failure (client_id and redirect_uri already checked),
      // so RFC 6749 §4.1.2.1 says it goes back to the client rather than 400.
      const response = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          state: 'state-no-pkce',
        })
        .expect(302);

      const location = new URL(response.headers.location);
      expect(location.origin + location.pathname).toBe(REDIRECT_URI);
      expect(location.searchParams.get('error')).toBe('invalid_request');
      expect(location.searchParams.get('error_description')).toContain(
        'code_challenge',
      );
      expect(location.searchParams.get('state')).toBe('state-no-pkce');
      expect(location.searchParams.get('iss')).toBe(SERVER_URL);
      // No session may be created for a request that never gets an auth code.
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('rejects an explicit code_challenge_method=plain', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: 'a-plain-verifier-used-as-its-own-challenge',
          code_challenge_method: 'plain',
          state: 'state-plain',
        })
        .expect(302);

      const location = new URL(response.headers.location);
      expect(location.searchParams.get('error')).toBe('invalid_request');
      expect(location.searchParams.get('error_description')).toContain('S256');
      expect(location.searchParams.get('iss')).toBe(SERVER_URL);
    });

    it('rejects an omitted code_challenge_method, which RFC 7636 §4.3 defines as plain', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: pkcePair().challenge,
          state: 'state-implicit-plain',
        })
        .expect(302);

      const location = new URL(response.headers.location);
      expect(location.searchParams.get('error')).toBe('invalid_request');
      expect(location.searchParams.get('error_description')).toContain('S256');
    });

    it('checks response_type before PKCE, so a bad response_type still names itself', async () => {
      // Ordering matters for diagnosability: a client sending response_type=token
      // and no challenge should hear about the response type it actually sent.
      const response = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'token',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          state: 'state-order',
        })
        .expect(302);

      expect(new URL(response.headers.location).searchParams.get('error')).toBe(
        'unsupported_response_type',
      );
    });

    it('completes the handshake with a conforming S256 challenge', async () => {
      const { verifier, challenge } = pkcePair();

      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'state-s256',
        })
        .expect(302);

      const callbackResponse = await request(harness.app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', cookieHeader(authorizeResponse))
        .query({ code: 'idp-code', state: 'ignored' })
        .expect(302);

      const authCode = new URL(
        callbackResponse.headers.location,
      ).searchParams.get('code')!;

      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code: authCode,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
          client_id: client.client_id,
        })
        .expect(200);
    });

    it('rejects a wrong verifier at the token endpoint', async () => {
      const { challenge } = pkcePair();

      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'state-bad-verifier',
        })
        .expect(302);

      const callbackResponse = await request(harness.app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', cookieHeader(authorizeResponse))
        .query({ code: 'idp-code', state: 'ignored' })
        .expect(302);

      const authCode = new URL(
        callbackResponse.headers.location,
      ).searchParams.get('code')!;

      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code: authCode,
          code_verifier: pkcePair().verifier,
          redirect_uri: REDIRECT_URI,
          client_id: client.client_id,
        })
        .expect(400);
    });

    it('refuses to redeem a code that carries no challenge at all', async () => {
      // The pre-fix bug: verification ran only `if (authCode.code_challenge)`,
      // so a code with no challenge was redeemed with no proof of possession.
      // `/authorize` cannot mint one any more, but a custom store or a code
      // issued by an older version still can — so the token endpoint checks too.
      const code = randomBytes(32).toString('base64url');
      await harness.store.storeAuthCode({
        code,
        user_id: 'testuser',
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code_challenge: undefined as unknown as string,
        code_challenge_method: undefined as unknown as string,
        expires_at: Date.now() + 60_000,
        resource: RESOURCE,
      });

      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: client.client_id,
        })
        .expect(400);
    });

    it('refuses to redeem a plain-bound code', async () => {
      const verifier = randomBytes(32).toString('base64url');
      const code = randomBytes(32).toString('base64url');
      await harness.store.storeAuthCode({
        code,
        user_id: 'testuser',
        client_id: client.client_id,
        redirect_uri: REDIRECT_URI,
        code_challenge: verifier,
        code_challenge_method: 'plain',
        expires_at: Date.now() + 60_000,
        resource: RESOURCE,
      });

      // The verifier matches the challenge — it is the *method* that is refused.
      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
          client_id: client.client_id,
        })
        .expect(400);
    });
  });

  describe('PKCE escape hatch (requirePkce: false)', () => {
    let harness: Harness;
    let client: OAuthClient;
    let warnSpy: jest.SpyInstance;

    beforeAll(async () => {
      warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      harness = await bootstrap({ requirePkce: false });
      client = await registerClient(harness.app);
    });

    afterAll(async () => {
      warnSpy.mockRestore();
      await harness.app.close();
    });

    it('warns once at bootstrap that PKCE is off', () => {
      const messages = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(messages.some((m) => m.includes('requirePkce: false'))).toBe(true);
    });

    it('still advertises only S256 — the hatch does not re-advertise plain', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.code_challenge_methods_supported).toEqual(['S256']);
    });

    it('lets a client through with no code_challenge and mints a token', async () => {
      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          state: 'state-hatch',
        })
        .expect(302);

      // Redirected to the IdP rather than back to the client with an error.
      expect(authorizeResponse.headers.location).toContain('mock-idp.example');

      const callbackResponse = await request(harness.app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', cookieHeader(authorizeResponse))
        .query({ code: 'idp-code', state: 'ignored' })
        .expect(302);

      const authCode = new URL(
        callbackResponse.headers.location,
      ).searchParams.get('code')!;

      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: REDIRECT_URI,
          client_id: client.client_id,
        })
        .expect(200);
    });

    it('still verifies a plain challenge when one is supplied', async () => {
      const verifier = randomBytes(32).toString('base64url');

      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: client.client_id,
          redirect_uri: REDIRECT_URI,
          code_challenge: verifier,
          code_challenge_method: 'plain',
          state: 'state-hatch-plain',
        })
        .expect(302);

      const callbackResponse = await request(harness.app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', cookieHeader(authorizeResponse))
        .query({ code: 'idp-code', state: 'ignored' })
        .expect(302);

      const authCode = new URL(
        callbackResponse.headers.location,
      ).searchParams.get('code')!;

      // Wrong verifier still fails; the hatch weakens the requirement, not the
      // verification of a challenge that was actually presented.
      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code: authCode,
          code_verifier: 'not-the-verifier',
          redirect_uri: REDIRECT_URI,
          client_id: client.client_id,
        })
        .expect(400);

      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code: authCode,
          code_verifier: verifier,
          redirect_uri: REDIRECT_URI,
          client_id: client.client_id,
        })
        .expect(200);
    });
  });

  describe('offline_access is not a protected-resource scope', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrap();
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('omits scopes_supported from the protected-resource metadata by default', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // The `2026-07-28` SHOULD NOT: refresh tokens are not a resource
      // requirement, so `offline_access` must not be advertised here. Nothing
      // else is configured in this harness, so the key is absent rather than
      // sent as an empty list.
      expect(response.body).not.toHaveProperty('scopes_supported');
      expect(response.body.bearer_methods_supported).toEqual(['header']);
    });

    it('keeps offline_access on the authorization server, where it is grantable', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      expect(response.body.scopes_supported).toContain('offline_access');
      expect(response.body.grant_types_supported).toContain('refresh_token');
    });

    it('echoes a configured protected-resource scope list', async () => {
      const configured = await bootstrap({
        protectedResourceMetadata: { scopesSupported: [DECLARED_SCOPE] },
      });
      try {
        const response = await request(configured.app.getHttpServer())
          .get('/.well-known/oauth-protected-resource')
          .expect(200);

        expect(response.body.scopes_supported).toEqual([DECLARED_SCOPE]);
      } finally {
        await configured.app.close();
      }
    });

    it('strips offline_access from BOTH lists when refresh tokens are disabled', async () => {
      // Pre-existing inconsistency: only the protected-resource list was
      // filtered, so `offline_access` stayed advertised — and, since scope
      // narrowing, grantable — on a server that never issues refresh tokens.
      const noRefresh = await bootstrap({ enableRefreshTokens: false });
      try {
        const as = await request(noRefresh.app.getHttpServer())
          .get('/.well-known/oauth-authorization-server')
          .expect(200);

        expect(as.body.scopes_supported).not.toContain('offline_access');
        expect(as.body.grant_types_supported).not.toContain('refresh_token');

        const pr = await request(noRefresh.app.getHttpServer())
          .get('/.well-known/oauth-protected-resource')
          .expect(200);

        expect(pr.body.scopes_supported ?? []).not.toContain('offline_access');
      } finally {
        await noRefresh.app.close();
      }
    });
  });

  describe('Dynamic Client Registration: application_type', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrap();
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it.each(['native', 'web'])('stores application_type=%s', async (type) => {
      const response = await postRegister(harness.app, {
        application_type: type,
      }).expect(201);

      expect(response.body.application_type).toBe(type);
      const stored = await harness.store.getClient(response.body.client_id);
      expect(stored!.application_type).toBe(type);
    });

    it('rejects an unknown application_type with 400', async () => {
      await postRegister(harness.app, {
        application_type: 'service',
      }).expect(400);
    });

    it('accepts a registration that omits it — MCP requires it of clients, not of us', async () => {
      // The spec makes `application_type` a client-side MUST with the explicit
      // carve-out that "non-OIDC servers safely ignore the parameter", so a
      // conforming pre-2026 client must not be locked out.
      const response = await postRegister(harness.app).expect(201);
      expect(response.body.client_id).toBeTruthy();
      expect(response.body.application_type).toBeUndefined();
    });

    it('does not apply the OIDC redirect-URI constraints for the declared type', async () => {
      // OIDC would demand https for `web` and localhost for `native`. This is a
      // plain OAuth 2.1 authorization server, so both register unchanged —
      // enforcing those rules would reject legitimate MCP clients.
      await postRegister(harness.app, {
        application_type: 'web',
        redirect_uris: ['http://localhost:8080/callback'],
      }).expect(201);

      await postRegister(harness.app, {
        application_type: 'native',
        redirect_uris: ['https://app.example.com/callback'],
      }).expect(201);
    });
  });

  describe('disableEndpoints.register', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrap({ disableEndpoints: { register: true } });
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('unregisters the DCR route entirely', async () => {
      await postRegister(harness.app).expect(404);
    });

    it('stops advertising registration_endpoint', async () => {
      const response = await request(harness.app.getHttpServer())
        .get('/.well-known/oauth-authorization-server')
        .expect(200);

      // Advertising an endpoint that answers 404 is worse than advertising none.
      expect(response.body).not.toHaveProperty('registration_endpoint');
      // The rest of the document is untouched.
      expect(response.body.token_endpoint).toContain('/auth/token');
    });

    it('leaves the other endpoints alone', async () => {
      await request(harness.app.getHttpServer())
        .get('/.well-known/oauth-protected-resource')
        .expect(200);
    });
  });
});
