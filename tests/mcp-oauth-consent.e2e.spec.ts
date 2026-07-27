/**
 * The interactive **consent screen** in `McpAuthModule` (§10 Tier 4).
 *
 * Before this existed, `/authorize` validated the request and went straight to
 * `passport.authenticate(...)`, and the IdP callback minted the authorization code
 * and redirected — the end user was never shown who was asking for what, or where
 * the code was about to be sent. That is also why consent had to land before
 * Client ID Metadata Documents: a CIMD-capable authorization server "**MUST**
 * clearly display the redirect URI hostname during authorization"
 * (`draft/basic/authorization/security-considerations`), and there is nowhere to
 * display it without a screen.
 *
 * Not parameterised over protocol eras, for the same reason as
 * `mcp-oauth-security.e2e.spec.ts`: every assertion is on the OAuth handshake,
 * which sits in front of the MCP transport and is era-independent.
 */
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Payload } from '@nestjs/microservices';
import cookieParser from 'cookie-parser';
import { createHash, randomBytes } from 'crypto';
import request from 'supertest';
import { z } from 'zod';
import { McpController, Tool, ToolScopes } from '@rekog/mcp-nest';
import { McpAuthModule, MemoryStore } from '@rekog/mcp-nest-auth';
import type {
  ConsentRenderContext,
  OAuthClient,
  OAuthProviderConfig,
  OAuthUserModuleOptions,
  OAuthUserProfile,
} from '@rekog/mcp-nest-auth';

const JWT_SECRET = 'oauth-consent-test-secret-at-least-32-characters';
const SERVER_URL = 'http://localhost:3000';
const RESOURCE = `${SERVER_URL}/mcp`;
/** Loopback on purpose: this is the case the spec wants extra warnings for. */
const LOOPBACK_REDIRECT = 'http://localhost:8080/callback';
const REMOTE_REDIRECT = 'https://app.example.com/oauth/callback';
const DECLARED_SCOPE = 'reports:read';

/** Same path-aware passport mock shape as `mcp-oauth-security.e2e.spec.ts`. */
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
          displayName: 'Ada Lovelace',
          emails: [{ value: 'ada@example.com' }],
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
}

type AuthOverrides = Partial<
  Omit<OAuthUserModuleOptions, 'provider' | 'jwtSecret' | 'storeConfiguration'>
>;

async function bootstrap(overrides: AuthOverrides = {}): Promise<Harness> {
  const store = new MemoryStore();

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
    controllers: [ScopedTools],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  await app.listen(0);

  return { app, store };
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return {
    verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  };
}

function cookieHeader(response: request.Response): string {
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).map((c) => c.split(';')[0]).join('; ');
}

async function registerClient(
  app: INestApplication,
  extra: Record<string, unknown> = {},
): Promise<OAuthClient> {
  const response = await request(app.getHttpServer())
    .post('/auth/register')
    .send({
      client_name: 'Consent Test Client',
      redirect_uris: [LOOPBACK_REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...extra,
    })
    .expect(201);
  return response.body;
}

/**
 * Drive `/authorize` → IdP → `/callback` and return whatever the callback
 * answered, plus the cookie jar the consent POST will need.
 */
async function runAuthorizeAndCallback(
  app: INestApplication,
  client: OAuthClient,
  options: {
    redirectUri?: string;
    scope?: string;
    state?: string;
    challenge?: string;
  } = {},
) {
  const authorizeResponse = await request(app.getHttpServer())
    .get('/auth/authorize')
    .query({
      response_type: 'code',
      client_id: client.client_id,
      redirect_uri: options.redirectUri ?? client.redirect_uris[0],
      code_challenge: options.challenge ?? pkcePair().challenge,
      code_challenge_method: 'S256',
      state: options.state ?? 'state-consent',
      ...(options.scope ? { scope: options.scope } : {}),
    })
    .expect(302);

  const cookies = cookieHeader(authorizeResponse);
  const callbackResponse = await request(app.getHttpServer())
    .get('/auth/callback')
    .set('Cookie', cookies)
    .query({ code: 'idp-code', state: 'ignored' });

  return { authorizeResponse, callbackResponse, cookies };
}

function postConsent(
  app: INestApplication,
  cookies: string,
  fields: Record<string, string>,
) {
  return request(app.getHttpServer())
    .post('/auth/consent')
    .set('Cookie', cookies)
    .type('form')
    .send(fields);
}

/** The `consent_token` the rendered form carries, read back out of the HTML. */
function consentTokenFrom(html: string): string {
  const match = /name="consent_token" value="([^"]+)"/.exec(html);
  expect(match).not.toBeNull();
  return match![1];
}

describe('E2E: OAuth consent screen', () => {
  describe('Consent is off by default', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrap();
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('mints the code straight from the callback, exactly as before', async () => {
      const client = await registerClient(harness.app);
      const { callbackResponse } = await runAuthorizeAndCallback(
        harness.app,
        client,
      );

      expect(callbackResponse.status).toBe(302);
      const location = new URL(callbackResponse.headers.location);
      expect(location.origin + location.pathname).toBe(LOOPBACK_REDIRECT);
      expect(location.searchParams.get('code')).toBeTruthy();
    });

    it('does not register the consent route at all', async () => {
      // Advertising a flow hop that nothing can complete would be worse than
      // having no route: a stray POST gets an honest 404.
      await postConsent(harness.app, '', { approve: 'true' }).expect(404);
    });
  });

  describe('Consent enabled', () => {
    let harness: Harness;
    let client: OAuthClient;

    beforeAll(async () => {
      // `rememberForMs: 0` so each case below starts from an unconsented state —
      // otherwise the first approval here would satisfy every later prompt for
      // the same (user, client, scope). Remembering is asserted on its own below.
      harness = await bootstrap({
        consent: { enabled: true, rememberForMs: 0 },
      });
      client = await registerClient(harness.app);
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('renders the screen after the IdP callback instead of redirecting', async () => {
      const { callbackResponse } = await runAuthorizeAndCallback(
        harness.app,
        client,
      );

      expect(callbackResponse.status).toBe(200);
      expect(callbackResponse.headers['content-type']).toContain('text/html');
      // No redirect, therefore no code: the client is still waiting.
      expect(callbackResponse.headers.location).toBeUndefined();
      expect(callbackResponse.text).toContain('Consent Test Client');
      expect(callbackResponse.text).toContain('Ada Lovelace');
      // A consent decision must never come out of a cache.
      expect(callbackResponse.headers['cache-control']).toContain('no-store');
    });

    it('displays the redirect URI hostname', async () => {
      // The CIMD MUST. `localhost` is the hostname of the redirect URI here; the
      // full URI is shown too, but the hostname is the load-bearing part.
      const { callbackResponse } = await runAuthorizeAndCallback(
        harness.app,
        client,
      );

      expect(callbackResponse.text).toContain(
        '<span class="value">localhost</span>',
      );
      expect(callbackResponse.text).toContain(LOOPBACK_REDIRECT);
    });

    it('warns about a loopback redirect URI', async () => {
      const { callbackResponse } = await runAuthorizeAndCallback(
        harness.app,
        client,
      );

      expect(callbackResponse.text).toContain('is a loopback address');
      expect(callbackResponse.text).toContain(
        'Approve only if you just started this application yourself',
      );
    });

    it('omits the loopback warning for a remote redirect URI', async () => {
      const remoteClient = await registerClient(harness.app, {
        client_name: 'Remote Consent Client',
        redirect_uris: [REMOTE_REDIRECT],
      });
      const { callbackResponse } = await runAuthorizeAndCallback(
        harness.app,
        remoteClient,
      );

      expect(callbackResponse.status).toBe(200);
      expect(callbackResponse.text).toContain(
        '<span class="value">app.example.com</span>',
      );
      expect(callbackResponse.text).not.toContain('is a loopback address');
    });

    it('lists the narrowed scopes that would be granted', async () => {
      const { callbackResponse } = await runAuthorizeAndCallback(
        harness.app,
        client,
        // `evil:admin` is declared nowhere, so scope narrowing drops it before
        // the screen is rendered — the user is shown what will actually be
        // granted, not what was asked for.
        { scope: `${DECLARED_SCOPE} evil:admin`, state: 'state-scopes' },
      );

      expect(callbackResponse.text).toContain(DECLARED_SCOPE);
      expect(callbackResponse.text).not.toContain('evil:admin');
    });

    it('blocks code issuance until the user approves, then mints it', async () => {
      const { verifier, challenge } = pkcePair();
      const { callbackResponse, cookies } = await runAuthorizeAndCallback(
        harness.app,
        client,
        { challenge, state: 'state-approve' },
      );
      expect(callbackResponse.status).toBe(200);

      const approve = await postConsent(harness.app, cookies, {
        consent_token: consentTokenFrom(callbackResponse.text),
        approve: 'true',
      }).expect(302);

      const location = new URL(approve.headers.location);
      expect(location.origin + location.pathname).toBe(LOOPBACK_REDIRECT);
      expect(location.searchParams.get('state')).toBe('state-approve');
      expect(location.searchParams.get('iss')).toBe(SERVER_URL);

      const code = location.searchParams.get('code')!;
      expect(code).toBeTruthy();

      // And the code is a real one, bound to the PKCE challenge from /authorize.
      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: LOOPBACK_REDIRECT,
          client_id: client.client_id,
        })
        .expect(200);
    });

    it('returns access_denied on the redirect URI when the user denies', async () => {
      const { callbackResponse, cookies } = await runAuthorizeAndCallback(
        harness.app,
        client,
        { state: 'state-deny' },
      );

      const denied = await postConsent(harness.app, cookies, {
        consent_token: consentTokenFrom(callbackResponse.text),
        approve: 'false',
      }).expect(302);

      const location = new URL(denied.headers.location);
      expect(location.origin + location.pathname).toBe(LOOPBACK_REDIRECT);
      expect(location.searchParams.get('error')).toBe('access_denied');
      expect(location.searchParams.get('state')).toBe('state-deny');
      expect(location.searchParams.get('iss')).toBe(SERVER_URL);
      expect(location.searchParams.get('code')).toBeNull();
    });

    it('refuses a POST with no consent token, and one with the wrong token', async () => {
      const { callbackResponse, cookies } = await runAuthorizeAndCallback(
        harness.app,
        client,
        { state: 'state-csrf' },
      );

      // The whole point: a cross-site form has the user's ambient cookies but
      // cannot read the token, which only ever travelled in an httpOnly cookie
      // and in this page's own markup.
      await postConsent(harness.app, cookies, { approve: 'true' }).expect(400);
      await postConsent(harness.app, cookies, {
        consent_token: randomBytes(32).toString('base64url'),
        approve: 'true',
      }).expect(400);

      // A refused CSRF attempt must not consume the pending decision.
      await postConsent(harness.app, cookies, {
        consent_token: consentTokenFrom(callbackResponse.text),
        approve: 'true',
      }).expect(302);
    });

    it('refuses a consent POST with no pending decision', async () => {
      await postConsent(harness.app, 'oauth_session=nope', {
        consent_token: 'whatever',
        approve: 'true',
      }).expect(400);
    });

    it('cannot be replayed: the session is gone once decided', async () => {
      const { callbackResponse, cookies } = await runAuthorizeAndCallback(
        harness.app,
        client,
        { state: 'state-replay' },
      );
      const token = consentTokenFrom(callbackResponse.text);

      await postConsent(harness.app, cookies, {
        consent_token: token,
        approve: 'true',
      }).expect(302);

      // A second approval would mint a second code for one authorization request.
      await postConsent(harness.app, cookies, {
        consent_token: token,
        approve: 'true',
      }).expect(400);
    });
  });

  describe('Remembered consent', () => {
    let harness: Harness;
    let client: OAuthClient;

    beforeAll(async () => {
      harness = await bootstrap({ consent: { enabled: true } });
      client = await registerClient(harness.app);
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('prompts once per (user, client, scope) and skips the screen afterwards', async () => {
      const first = await runAuthorizeAndCallback(harness.app, client, {
        scope: DECLARED_SCOPE,
        state: 'state-remember-1',
      });
      expect(first.callbackResponse.status).toBe(200);

      await postConsent(harness.app, first.cookies, {
        consent_token: consentTokenFrom(first.callbackResponse.text),
        approve: 'true',
      }).expect(302);

      // Same user, same client, same scope: straight through, no screen.
      const second = await runAuthorizeAndCallback(harness.app, client, {
        scope: DECLARED_SCOPE,
        state: 'state-remember-2',
      });
      expect(second.callbackResponse.status).toBe(302);
      expect(
        new URL(second.callbackResponse.headers.location).searchParams.get(
          'code',
        ),
      ).toBeTruthy();

      // Scope order is normalised, so the same set spelled differently is still
      // the same grant.
      const reordered = await runAuthorizeAndCallback(harness.app, client, {
        scope: `offline_access ${DECLARED_SCOPE}`,
        state: 'state-remember-3',
      });
      expect(reordered.callbackResponse.status).toBe(200);
    });

    it('prompts again when the client asks for more scope than was approved', async () => {
      const wider = await runAuthorizeAndCallback(harness.app, client, {
        scope: `${DECLARED_SCOPE} offline_access`,
        state: 'state-remember-wider',
      });
      expect(wider.callbackResponse.status).toBe(200);
    });

    it('prompts again for a different client', async () => {
      const other = await registerClient(harness.app, {
        client_name: 'Second Consent Client',
      });
      const { callbackResponse } = await runAuthorizeAndCallback(
        harness.app,
        other,
        { scope: DECLARED_SCOPE, state: 'state-remember-other' },
      );
      expect(callbackResponse.status).toBe(200);
    });
  });

  describe('rememberForMs: 0 prompts every time', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrap({
        consent: { enabled: true, rememberForMs: 0 },
      });
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('shows the screen again after an approval', async () => {
      const client = await registerClient(harness.app);
      const first = await runAuthorizeAndCallback(harness.app, client, {
        state: 'state-noremember-1',
      });
      await postConsent(harness.app, first.cookies, {
        consent_token: consentTokenFrom(first.callbackResponse.text),
        approve: 'true',
      }).expect(302);

      const second = await runAuthorizeAndCallback(harness.app, client, {
        state: 'state-noremember-2',
      });
      expect(second.callbackResponse.status).toBe(200);
    });
  });

  describe('Custom render', () => {
    let harness: Harness;
    const seen: ConsentRenderContext[] = [];

    beforeAll(async () => {
      harness = await bootstrap({
        consent: {
          enabled: true,
          render: (ctx) => {
            seen.push(ctx);
            return (
              `<!doctype html><html><body><h1>CUSTOM SCREEN</h1>` +
              `<form method="post" action="${ctx.formAction}">` +
              `<input type="hidden" name="consent_token" value="${ctx.csrfToken}">` +
              `<button name="approve" value="true">yes</button></form></body></html>`
            );
          },
        },
      });
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('replaces the built-in page and still completes the flow', async () => {
      const client = await registerClient(harness.app);
      const { callbackResponse, cookies } = await runAuthorizeAndCallback(
        harness.app,
        client,
        { scope: DECLARED_SCOPE, state: 'state-custom' },
      );

      expect(callbackResponse.status).toBe(200);
      expect(callbackResponse.text).toContain('CUSTOM SCREEN');
      // None of the built-in page survives.
      expect(callbackResponse.text).not.toContain('is a loopback address');

      const approved = await postConsent(harness.app, cookies, {
        consent_token: consentTokenFrom(callbackResponse.text),
        approve: 'true',
      }).expect(302);
      expect(
        new URL(approved.headers.location).searchParams.get('code'),
      ).toBeTruthy();
    });

    it('receives the facts the spec makes normative', async () => {
      const ctx = seen.at(-1)!;
      expect(ctx.redirectUri).toBe(LOOPBACK_REDIRECT);
      expect(ctx.redirectUriHost).toBe('localhost');
      expect(ctx.isLoopbackRedirect).toBe(true);
      expect(ctx.isLoopbackOnlyClient).toBe(true);
      expect(ctx.isMetadataDocumentClient).toBe(false);
      expect(ctx.client.client_name).toBe('Consent Test Client');
      expect(ctx.scopes).toEqual([DECLARED_SCOPE]);
      expect(ctx.user.displayName).toBe('Ada Lovelace');
      expect(ctx.formAction).toBe('/auth/consent');
    });
  });

  describe('HTML escaping', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrap({ consent: { enabled: true } });
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('escapes a client_name containing markup', async () => {
      // Load-bearing once CIMD is on: `client_name` then comes from a document
      // hosted by whoever picked the client_id, and this page renders on the
      // authorization server's own origin, where the session cookie lives.
      const client = await registerClient(harness.app, {
        client_name: '<script>alert(1)</script>',
      });
      const { callbackResponse } = await runAuthorizeAndCallback(
        harness.app,
        client,
        { state: 'state-xss' },
      );

      expect(callbackResponse.status).toBe(200);
      expect(callbackResponse.text).not.toContain('<script>alert(1)</script>');
      expect(callbackResponse.text).toContain(
        '&lt;script&gt;alert(1)&lt;/script&gt;',
      );
    });
  });

  describe('Coupling with Client ID Metadata Documents', () => {
    it('forces consent on when CIMD is enabled', async () => {
      const harness = await bootstrap({
        clientIdMetadataDocuments: { enabled: true },
      });
      try {
        const client = await registerClient(harness.app);
        const { callbackResponse } = await runAuthorizeAndCallback(
          harness.app,
          client,
          { state: 'state-cimd-forces-consent' },
        );
        // Consent was never asked for in the options — CIMD implied it.
        expect(callbackResponse.status).toBe(200);
        expect(callbackResponse.text).toContain(
          'Authorization code will be sent to',
        );
      } finally {
        await harness.app.close();
      }
    });

    it('refuses to boot with CIMD enabled and consent explicitly disabled', () => {
      // Silently ignoring a security-relevant opt-out is worse than failing.
      expect(() =>
        McpAuthModule.forRoot({
          provider: MockProvider,
          clientId: 'mock-client-id',
          clientSecret: 'mock-client-secret',
          jwtSecret: JWT_SECRET,
          serverUrl: SERVER_URL,
          resource: RESOURCE,
          consent: { enabled: false },
          clientIdMetadataDocuments: { enabled: true },
        }),
      ).toThrow(/consent\.enabled was explicitly set to false/);
    });

    it('still allows consent on with CIMD off', () => {
      expect(() =>
        McpAuthModule.forRoot({
          provider: MockProvider,
          clientId: 'mock-client-id',
          clientSecret: 'mock-client-secret',
          jwtSecret: JWT_SECRET,
          serverUrl: SERVER_URL,
          resource: RESOURCE,
          consent: { enabled: true },
        }),
      ).not.toThrow();
    });

    it('warns at bootstrap when the insecure client-id hatch is on', async () => {
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        McpAuthModule.forRoot({
          provider: MockProvider,
          clientId: 'mock-client-id',
          clientSecret: 'mock-client-secret',
          jwtSecret: JWT_SECRET,
          serverUrl: SERVER_URL,
          resource: RESOURCE,
          clientIdMetadataDocuments: {
            enabled: true,
            allowInsecureClientIdScheme: true,
          },
        });
        const messages = warnSpy.mock.calls.map((call) => String(call[0]));
        expect(
          messages.some((m) => m.includes('allowInsecureClientIdScheme')),
        ).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
