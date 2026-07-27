/**
 * **Client ID Metadata Documents** (CIMD) in `McpAuthModule` (§10 Tier 4) —
 * [draft-ietf-oauth-client-id-metadata-document-00](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00),
 * the mechanism MCP revision `2026-07-28` prefers over Dynamic Client
 * Registration (`draft/basic/authorization/client-registration`).
 *
 * ## No outbound network calls
 *
 * Every document in this file is served by a **local `http.Server`** bound to
 * 127.0.0.1, reached through the deliberately development-only
 * `allowInsecureClientIdScheme` hatch (which is what accepts `http://` *and*
 * stops the SSRF guard refusing loopback). A fetch seam would have been less
 * work, but it would have bypassed exactly the code most likely to be wrong: the
 * `node:http` request path, the pinned-DNS `lookup` override, the streaming byte
 * cap, the status/redirect handling and the `Cache-Control` parsing. The server
 * also counts requests per path, which is how "cached" and "not cached" are
 * asserted as facts rather than as internal state.
 *
 * The SSRF cases are the exception and run on a harness with the hatch **off** —
 * they must be refused before any connection is attempted, so they need no server
 * at all.
 *
 * Not parameterised over protocol eras: everything here is the OAuth handshake,
 * which sits in front of the MCP transport (see `mcp-oauth-security.e2e.spec.ts`).
 */
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { createHash, randomBytes } from 'crypto';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { McpAuthModule, MemoryStore } from '@rekog/mcp-nest-auth';
import type {
  OAuthProviderConfig,
  OAuthUserModuleOptions,
  OAuthUserProfile,
} from '@rekog/mcp-nest-auth';

const JWT_SECRET = 'oauth-cimd-test-secret-at-least-32-characters-long';
const SERVER_URL = 'http://localhost:3000';
const RESOURCE = `${SERVER_URL}/mcp`;
const CLIENT_REDIRECT = 'http://127.0.0.1:33418/callback';

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

// ---------------------------------------------------------------------------
// The client's own metadata-document host.
// ---------------------------------------------------------------------------

interface DocumentRoute {
  status?: number;
  /** Sent verbatim, so a malformed or oversized body can be expressed. */
  body: string;
  headers?: Record<string, string>;
}

interface DocumentServer {
  origin: string;
  /** Register/replace what a path answers with. */
  serve(path: string, route: DocumentRoute): void;
  /** Register a JSON document, filling in `client_id` from the path. */
  serveDocument(path: string, document: Record<string, unknown>): string;
  hits(path: string): number;
  close(): Promise<void>;
}

async function startDocumentServer(): Promise<DocumentServer> {
  const routes = new Map<string, DocumentRoute>();
  const hits = new Map<string, number>();

  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    hits.set(path, (hits.get(path) ?? 0) + 1);

    const route = routes.get(path);
    if (!route) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(route.status ?? 200, {
      'content-type': 'application/json',
      ...(route.headers ?? {}),
    });
    res.end(route.body);
  });

  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  );
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    serve(path, route) {
      routes.set(path, route);
    },
    serveDocument(path, document) {
      const clientId = `${origin}${path}`;
      routes.set(path, {
        body: JSON.stringify({ client_id: clientId, ...document }),
      });
      return clientId;
    },
    hits: (path) => hits.get(path) ?? 0,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

/** The document shape the MCP spec's own example uses. */
function validDocument(extra: Record<string, unknown> = {}) {
  return {
    client_name: 'Example MCP Client',
    client_uri: 'https://app.example.com',
    redirect_uris: [CLIENT_REDIRECT],
    grant_types: ['authorization_code'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  await app.listen(0);

  return { app, store };
}

/** CIMD on, with the loopback/`http` development hatch. */
function bootstrapCimd(overrides: AuthOverrides = {}) {
  return bootstrap({
    clientIdMetadataDocuments: {
      enabled: true,
      allowInsecureClientIdScheme: true,
    },
    // Consent is forced on by CIMD; `rememberForMs: 0` keeps each case
    // independent of whichever one approved first.
    consent: { enabled: true, rememberForMs: 0 },
    ...overrides,
  });
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

function cookieValue(response: request.Response, name: string): string {
  const raw = response.headers['set-cookie'] as unknown as string[] | undefined;
  const match = (raw ?? []).find((c) => c.startsWith(`${name}=`));
  return decodeURIComponent(match!.split(';')[0].slice(name.length + 1));
}

function authorize(
  app: INestApplication,
  clientId: string,
  extra: Record<string, string> = {},
) {
  return request(app.getHttpServer())
    .get('/auth/authorize')
    .query({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: CLIENT_REDIRECT,
      code_challenge: pkcePair().challenge,
      code_challenge_method: 'S256',
      state: 'state-cimd',
      ...extra,
    });
}

describe('E2E: OAuth Client ID Metadata Documents', () => {
  let docs: DocumentServer;

  beforeAll(async () => {
    docs = await startDocumentServer();
  });

  afterAll(async () => {
    await docs.close();
  });

  describe('Advertising support', () => {
    it('omits client_id_metadata_document_supported when disabled', async () => {
      const harness = await bootstrap();
      try {
        const response = await request(harness.app.getHttpServer())
          .get('/.well-known/oauth-authorization-server')
          .expect(200);

        // Absence is how "unsupported" is expressed; sending `false` would be a
        // second way to say the same thing.
        expect(response.body).not.toHaveProperty(
          'client_id_metadata_document_supported',
        );
        // DCR is still the advertised path on such a server.
        expect(response.body.registration_endpoint).toContain('/auth/register');
      } finally {
        await harness.app.close();
      }
    });

    it('advertises it when enabled', async () => {
      const harness = await bootstrapCimd();
      try {
        const response = await request(harness.app.getHttpServer())
          .get('/.well-known/oauth-authorization-server')
          .expect(200);

        expect(response.body.client_id_metadata_document_supported).toBe(true);
      } finally {
        await harness.app.close();
      }
    });
  });

  describe('Resolution', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrapCimd();
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('resolves a URL-shaped client_id and starts the flow', async () => {
      const clientId = docs.serveDocument('/ok/client.json', validDocument());

      const response = await authorize(harness.app, clientId).expect(302);
      expect(response.headers.location).toContain('mock-idp.example');

      // The session records the URL as the client_id and pins the document.
      const session = await harness.store.getOAuthSession(
        cookieValue(response, 'oauth_session'),
      );
      expect(session!.clientId).toBe(clientId);
      expect(session!.clientMetadata!.client_name).toBe('Example MCP Client');
      expect(session!.clientMetadata!.token_endpoint_auth_method).toBe('none');
      // Nothing was registered: CIMD writes nothing to the store.
      expect(await harness.store.getClient(clientId)).toBeUndefined();
    });

    it('fetches the document exactly once and then serves it from cache', async () => {
      const clientId = docs.serveDocument(
        '/cached/client.json',
        validDocument(),
      );

      await authorize(harness.app, clientId).expect(302);
      expect(docs.hits('/cached/client.json')).toBe(1);

      await authorize(harness.app, clientId, {
        state: 'state-cimd-2',
      }).expect(302);
      // "SHOULD cache metadata respecting HTTP cache headers" — no headers here,
      // so the configured default TTL applies and the second authorize is free.
      expect(docs.hits('/cached/client.json')).toBe(1);
    });

    it('does not cache when the document says no-store', async () => {
      const clientId = `${docs.origin}/nostore/client.json`;
      docs.serve('/nostore/client.json', {
        body: JSON.stringify({ client_id: clientId, ...validDocument() }),
        headers: { 'cache-control': 'no-store' },
      });

      await authorize(harness.app, clientId).expect(302);
      await authorize(harness.app, clientId, {
        state: 'state-nostore-2',
      }).expect(302);
      expect(docs.hits('/nostore/client.json')).toBe(2);
    });

    it('honours max-age=0 as "do not cache"', async () => {
      const clientId = `${docs.origin}/maxage0/client.json`;
      docs.serve('/maxage0/client.json', {
        body: JSON.stringify({ client_id: clientId, ...validDocument() }),
        headers: { 'cache-control': 'public, max-age=0' },
      });

      await authorize(harness.app, clientId).expect(302);
      await authorize(harness.app, clientId, {
        state: 'state-maxage0-2',
      }).expect(302);
      expect(docs.hits('/maxage0/client.json')).toBe(2);
    });
  });

  describe('Document validation', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrapCimd();
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('rejects a document whose client_id does not match the URL', async () => {
      // The entire binding between "the URL we fetched" and "the identity we are
      // about to grant" is this equality — a mismatch means some other client's
      // document is being replayed under a URL its author does not control.
      docs.serve('/mismatch/client.json', {
        body: JSON.stringify({
          client_id: 'https://someone-else.example/client.json',
          ...validDocument(),
        }),
      });

      const response = await authorize(
        harness.app,
        `${docs.origin}/mismatch/client.json`,
      ).expect(400);
      expect(response.body.message).toContain('does not match the URL');
    });

    it('rejects a document with no client_name', async () => {
      const clientId = `${docs.origin}/no-name/client.json`;
      docs.serve('/no-name/client.json', {
        body: JSON.stringify({
          client_id: clientId,
          redirect_uris: [CLIENT_REDIRECT],
        }),
      });

      await authorize(harness.app, clientId).expect(400);
    });

    it.each([
      ['absent', undefined],
      ['empty', []],
      ['not an array', 'http://127.0.0.1:33418/callback'],
      ['not strings', [{ uri: 'x' }]],
    ])('rejects redirect_uris that are %s', async (label, value) => {
      const path = `/redirects-${label.replace(/\s+/g, '-')}/client.json`;
      const clientId = `${docs.origin}${path}`;
      docs.serve(path, {
        body: JSON.stringify({
          client_id: clientId,
          client_name: 'Example MCP Client',
          ...(value === undefined ? {} : { redirect_uris: value }),
        }),
      });

      await authorize(harness.app, clientId).expect(400);
    });

    it('rejects a redirect_uri that is not in the document', async () => {
      const clientId = docs.serveDocument(
        '/other-redirect/client.json',
        validDocument({ redirect_uris: ['http://127.0.0.1:9999/other'] }),
      );

      await authorize(harness.app, clientId).expect(400);
      // The exact same request with a declared URI succeeds, so the rejection is
      // the redirect-URI check and not the document.
      await authorize(harness.app, clientId, {
        redirect_uri: 'http://127.0.0.1:9999/other',
      }).expect(302);
    });

    it.each(['client_secret_basic', 'client_secret_post', 'client_secret_jwt'])(
      'rejects token_endpoint_auth_method=%s',
      async (method) => {
        const path = `/authmethod-${method}/client.json`;
        const clientId = docs.serveDocument(
          path,
          validDocument({ token_endpoint_auth_method: method }),
        );

        await authorize(harness.app, clientId).expect(400);
      },
    );

    it('rejects a document carrying a client_secret', async () => {
      const clientId = docs.serveDocument(
        '/has-secret/client.json',
        validDocument({ client_secret: 'nope' }),
      );

      await authorize(harness.app, clientId).expect(400);
    });

    it('rejects a document carrying client_secret_expires_at', async () => {
      const clientId = docs.serveDocument(
        '/has-secret-exp/client.json',
        validDocument({ client_secret_expires_at: 0 }),
      );

      await authorize(harness.app, clientId).expect(400);
    });

    it('rejects private_key_jwt up front rather than failing at /token', async () => {
      // Legal in a CIMD document, unimplemented here. Accepting it at /authorize
      // would hand the client an authorization code it could never redeem — after
      // the user had already consented.
      const clientId = docs.serveDocument(
        '/pkjwt/client.json',
        validDocument({
          token_endpoint_auth_method: 'private_key_jwt',
          jwks_uri: 'https://app.example.com/jwks.json',
        }),
      );

      const response = await authorize(harness.app, clientId).expect(400);
      expect(response.body.message).toContain('not supported');
    });

    it('rejects a body that is not JSON', async () => {
      docs.serve('/notjson/client.json', { body: '<html>nope</html>' });
      await authorize(harness.app, `${docs.origin}/notjson/client.json`).expect(
        400,
      );
    });

    it('rejects a JSON body that is not an object', async () => {
      docs.serve('/array/client.json', { body: '[]' });
      await authorize(harness.app, `${docs.origin}/array/client.json`).expect(
        400,
      );
    });
  });

  describe('client_id URL requirements', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrapCimd();
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('rejects a URL with no path component', async () => {
      // "The client_id URL MUST ... contain a path component".
      for (const clientId of [docs.origin, `${docs.origin}/`]) {
        const response = await authorize(harness.app, clientId).expect(400);
        expect(response.body.message).toContain('path component');
      }
    });

    it('rejects dot segments', async () => {
      // Checked on the raw string: WHATWG URL parsing silently collapses these,
      // so by the time there is a URL object the evidence is gone.
      for (const path of ['/a/../client.json', '/./client.json']) {
        const response = await authorize(
          harness.app,
          `${docs.origin}${path}`,
        ).expect(400);
        expect(response.body.message).toContain('dot');
      }
    });

    it('rejects a fragment', async () => {
      const response = await authorize(
        harness.app,
        `${docs.origin}/ok/client.json#frag`,
      ).expect(400);
      expect(response.body.message).toContain('fragment');
    });

    it('rejects userinfo in the authority', async () => {
      const response = await authorize(
        harness.app,
        `http://user:pass@127.0.0.1:1/client.json`,
      ).expect(400);
      expect(response.body.message).toContain('userinfo');
    });
  });

  describe('Fetch failures abort the authorization request', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrapCimd();
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('rejects a non-200 response', async () => {
      docs.serve('/error/client.json', { status: 500, body: 'boom' });
      await authorize(harness.app, `${docs.origin}/error/client.json`).expect(
        400,
      );
    });

    it('rejects a 404 (nothing hosted at the URL)', async () => {
      await authorize(harness.app, `${docs.origin}/absent/client.json`).expect(
        400,
      );
    });

    it('does not follow redirects', async () => {
      // Following one would need the SSRF guard re-run against a target the
      // client gets to choose *after* its URL was vetted.
      const clientId = `${docs.origin}/redirect/client.json`;
      docs.serveDocument('/redirect-target/client.json', validDocument());
      docs.serve('/redirect/client.json', {
        status: 302,
        body: '',
        headers: { location: `${docs.origin}/redirect-target/client.json` },
      });

      const response = await authorize(harness.app, clientId).expect(400);
      expect(response.body.message).toContain('HTTP 302');
      // The target was never touched.
      expect(docs.hits('/redirect-target/client.json')).toBe(0);
    });

    it('rejects a body over the 5 KB recommended maximum', async () => {
      const clientId = `${docs.origin}/huge/client.json`;
      docs.serve('/huge/client.json', {
        body: JSON.stringify({
          client_id: clientId,
          ...validDocument({ padding: 'x'.repeat(6 * 1024) }),
        }),
      });

      const response = await authorize(harness.app, clientId).expect(400);
      expect(response.body.message).toContain('larger than');
    });

    it('rejects an unreachable origin', async () => {
      // Port 1 on loopback: nothing listens, so this is a connection error rather
      // than an HTTP one. Reachable only because the development hatch permits
      // loopback at all.
      await authorize(harness.app, 'http://127.0.0.1:1/client.json').expect(
        400,
      );
    });

    it('caches neither an error response nor a malformed document', async () => {
      // "The authorization server MUST NOT cache error responses. The
      // authorization server also MUST NOT cache documents which are invalid or
      // malformed." Proven by the origin being hit again, not by inspecting state.
      docs.serve('/nocache-error/client.json', { status: 503, body: 'nope' });
      await authorize(
        harness.app,
        `${docs.origin}/nocache-error/client.json`,
      ).expect(400);
      await authorize(
        harness.app,
        `${docs.origin}/nocache-error/client.json`,
      ).expect(400);
      expect(docs.hits('/nocache-error/client.json')).toBe(2);

      docs.serve('/nocache-malformed/client.json', { body: '{oops' });
      await authorize(
        harness.app,
        `${docs.origin}/nocache-malformed/client.json`,
      ).expect(400);
      await authorize(
        harness.app,
        `${docs.origin}/nocache-malformed/client.json`,
      ).expect(400);
      expect(docs.hits('/nocache-malformed/client.json')).toBe(2);

      // And once the origin is fixed, the very next request succeeds — nothing
      // negative was remembered.
      docs.serveDocument('/nocache-malformed/client.json', validDocument());
      await authorize(
        harness.app,
        `${docs.origin}/nocache-malformed/client.json`,
      ).expect(302);
    });
  });

  describe('SSRF guard (development hatch OFF)', () => {
    let harness: Harness;

    beforeAll(async () => {
      // No `allowInsecureClientIdScheme`: this is the production posture.
      harness = await bootstrap({
        clientIdMetadataDocuments: { enabled: true },
      });
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('rejects a non-https client_id', async () => {
      // Would otherwise be a perfectly serviceable document — the local server
      // that the rest of this file uses.
      const response = await authorize(
        harness.app,
        `${docs.origin}/ok/client.json`,
      ).expect(400);
      expect(response.body.message).toContain('https scheme');
    });

    it.each([
      ['loopback literal', 'https://127.0.0.1/client.json'],
      ['IPv6 loopback literal', 'https://[::1]/client.json'],
      ['IPv4-mapped loopback', 'https://[::ffff:127.0.0.1]/client.json'],
      ['RFC 1918', 'https://10.0.0.5/client.json'],
      ['RFC 1918 (172.16/12)', 'https://172.20.1.1/client.json'],
      ['RFC 1918 (192.168/16)', 'https://192.168.1.1/client.json'],
      ['link-local', 'https://169.254.169.254/client.json'],
      ['CGNAT', 'https://100.64.0.1/client.json'],
      ['unspecified', 'https://0.0.0.0/client.json'],
    ])('refuses an address literal in %s space', async (_label, clientId) => {
      const response = await authorize(harness.app, clientId).expect(400);
      // Refused before any connection is attempted, which is why these cases
      // need no server listening anywhere.
      expect(response.body.message).toContain('refusing to fetch');
    });

    it('refuses a hostname that RESOLVES to a loopback address', async () => {
      // The interesting attack: the URL looks fine, the DNS answer does not.
      // Catching this is why the guard resolves first instead of only pattern
      // matching the literal. `localhost` resolves locally with no outbound DNS.
      const response = await authorize(
        harness.app,
        'https://localhost/client.json',
      ).expect(400);
      expect(response.body.message).toContain('resolves to');
    });

    it('still resolves a DCR client_id unchanged', async () => {
      // Regression guard: turning CIMD on must not disturb the registered-client
      // path, whose ids can never look like URLs.
      const registered = await request(harness.app.getHttpServer())
        .post('/auth/register')
        .send({
          client_name: 'Registered Client',
          redirect_uris: [CLIENT_REDIRECT],
        })
        .expect(201);

      await authorize(harness.app, registered.body.client_id).expect(302);
    });
  });

  describe('CIMD clients are DCR-free but otherwise ordinary', () => {
    let harness: Harness;

    beforeAll(async () => {
      harness = await bootstrapCimd();
    });

    afterAll(async () => {
      await harness.app.close();
    });

    it('completes authorize → consent → code → token with the URL as client_id', async () => {
      const clientId = docs.serveDocument('/full/client.json', validDocument());
      const { verifier, challenge } = pkcePair();

      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: CLIENT_REDIRECT,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'state-full',
        })
        .expect(302);

      const cookies = cookieHeader(authorizeResponse);
      const consentPage = await request(harness.app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', cookies)
        .query({ code: 'idp-code', state: 'ignored' })
        .expect(200);

      // The consent screen names the client from its document, shows the
      // redirect-URI hostname (the MUST) and warns about loopback (the SHOULD).
      expect(consentPage.text).toContain('Example MCP Client');
      expect(consentPage.text).toContain(
        '<span class="value">127.0.0.1</span>',
      );
      expect(consentPage.text).toContain('is a loopback address');
      // And it says the name came from a document anyone may reference.
      expect(consentPage.text).toContain(
        'come from a document that anyone may reference',
      );
      expect(consentPage.text).toContain(clientId);

      const token = /name="consent_token" value="([^"]+)"/.exec(
        consentPage.text,
      )![1];
      const approved = await request(harness.app.getHttpServer())
        .post('/auth/consent')
        .set('Cookie', cookies)
        .type('form')
        .send({ consent_token: token, approve: 'true' })
        .expect(302);

      const code = new URL(approved.headers.location).searchParams.get('code')!;
      expect(code).toBeTruthy();

      // The code carries the document snapshot, which is what the token endpoint
      // validates against.
      const stored = await harness.store.getAuthCode(code);
      expect(stored!.client_metadata!.client_id).toBe(clientId);

      const hitsBeforeRedemption = docs.hits('/full/client.json');
      const tokenResponse = await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: CLIENT_REDIRECT,
          client_id: clientId,
        })
        .expect(200);

      expect(tokenResponse.body.access_token).toBeTruthy();
      // Redemption used the snapshot, not a fresh fetch.
      expect(docs.hits('/full/client.json')).toBe(hitsBeforeRedemption);
    });

    it('rejects a client_secret from a CIMD client at the token endpoint', async () => {
      // A CIMD client is public by construction, so presenting a secret means
      // something is impersonating it (or is badly misconfigured).
      const clientId = docs.serveDocument(
        '/public-only/client.json',
        validDocument(),
      );
      const { verifier, challenge } = pkcePair();

      const authorizeResponse = await request(harness.app.getHttpServer())
        .get('/auth/authorize')
        .query({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: CLIENT_REDIRECT,
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state: 'state-public-only',
        })
        .expect(302);

      const cookies = cookieHeader(authorizeResponse);
      const consentPage = await request(harness.app.getHttpServer())
        .get('/auth/callback')
        .set('Cookie', cookies)
        .query({ code: 'idp-code', state: 'ignored' })
        .expect(200);

      const approved = await request(harness.app.getHttpServer())
        .post('/auth/consent')
        .set('Cookie', cookies)
        .type('form')
        .send({
          consent_token: /name="consent_token" value="([^"]+)"/.exec(
            consentPage.text,
          )![1],
          approve: 'true',
        })
        .expect(302);

      const code = new URL(approved.headers.location).searchParams.get('code')!;

      await request(harness.app.getHttpServer())
        .post('/auth/token')
        .send({
          grant_type: 'authorization_code',
          code,
          code_verifier: verifier,
          redirect_uri: CLIENT_REDIRECT,
          client_id: clientId,
          client_secret: 'invented',
        })
        .expect(400);
    });

    it('leaves an unknown non-URL client_id answering exactly as before', async () => {
      await authorize(harness.app, 'no-such-client').expect(400);
    });
  });
});
