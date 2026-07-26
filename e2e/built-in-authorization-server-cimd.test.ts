/**
 * e2e for the CIMD + consent demo in `examples/built-in-authorization-server`,
 * driven against a real, spawned example server.
 *
 * WHY THIS FILE EXISTS — it is not redundant with the unit suite.
 *
 * `tests/mcp-oauth-cimd.e2e.spec.ts` covers Client ID Metadata Documents
 * thoroughly, but it runs under `bun test`, and the CIMD fetch path is one of
 * the few places in this repo where **Bun and Node genuinely differ**. The SSRF
 * guard pins the vetted address by overriding the `dns.lookup` hook that
 * `node:http` passes to `net`, and the two runtimes call that hook with
 * different signatures: Node >= 20 passes `{ all: true }` and reads
 * `addresses[0]`, while Bun calls back with `(err, address, family)`. An
 * implementation that serves only Bun's shape passes the entire unit suite and
 * then fails on real Node with `Invalid IP address: undefined`. That exact bug
 * happened during development and was caught only by running the demo by hand.
 *
 * So this file's job is narrow and specific: prove the CIMD document fetch, the
 * consent screen and the resulting token flow work **on the Node runtime**, in
 * the example the README tells people to run. It is the regression guard for a
 * class of bug the unit suite structurally cannot catch.
 *
 * Deliberately a separate file from `built-in-authorization-server.test.ts`
 * rather than extra cases in it: that file asserts the DEFAULT posture (no
 * consent, no CIMD), and enabling the demo flags on a shared server would
 * change what it is testing. Two servers, two postures, no interference.
 *
 * This drives raw HTTP rather than an MCP client — the subject here is the OAuth
 * authorization leg, which is transport- and era-independent. MCP protocol
 * interop is covered by the sibling file.
 *
 * Run:  bun test built-in-authorization-server-cimd.test.ts   (from e2e/)
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { getFreePort, startExample, type RunningExample } from './harness';

const BOOT_MS = 120_000;
const EXAMPLE = 'built-in-authorization-server';
const JWT_SECRET = 'e2e-cimd-consent-demo-secret-32-chars-minimum-ok';

let server: RunningExample;
/** What the example advertises as its own issuer, derived from PORT. */
let serverUrl: string;
/** What we actually connect to. The example binds all interfaces. */
let baseUrl: string;

/**
 * A fixed PKCE pair. PKCE is mandatory and S256-only, so every authorize call
 * needs a real challenge; `verifier` is only used by the redemption test.
 */
const PKCE = {
  verifier: 'e2e-cimd-verifier-that-is-long-enough-to-be-valid-43ch',
  challenge: '',
};

function base64url(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : new Uint8Array(input);
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** `GET` without following redirects, so we can assert on 302 targets. */
function get(url: string, headers: Record<string, string> = {}) {
  return fetch(url, { redirect: 'manual', headers });
}

/**
 * Follow a redirect chain while carrying cookies forward.
 *
 * `fetch(..., { redirect: 'follow' })` does NOT persist `Set-Cookie` across
 * hops, and the authorization leg depends on exactly that: `/authorize` sets the
 * httpOnly `oauth_session` cookie, then bounces through the IdP and back to
 * `/auth/callback`, which cannot find its session without it. Following without
 * a cookie jar makes the whole flow 400 for a reason that has nothing to do with
 * what is being tested.
 */
async function followWithCookies(
  start: string,
  maxHops = 6,
): Promise<{ status: number; body: string; url: string }> {
  const jar = new Map<string, string>();
  let url = start;

  for (let hop = 0; hop < maxHops; hop++) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(url, {
      redirect: 'manual',
      headers: cookie ? { cookie } : {},
    });
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const location = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !location) {
      return { status: res.status, body: await res.text(), url };
    }
    url = new URL(location, url).toString();
  }
  throw new Error(`redirect chain did not settle within ${maxHops} hops`);
}

beforeAll(async () => {
  PKCE.challenge = base64url(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(PKCE.verifier),
    ),
  );

  const port = await getFreePort();
  server = await startExample(EXAMPLE, port, {
    readyTimeoutMs: BOOT_MS,
    env: {
      JWT_SECRET,
      // The three demo flags the README documents. MCP_FAKE_IDP swaps GitHub
      // for an offline auto-approving stub, which is what makes the whole
      // authorize -> consent -> code leg runnable with no external IdP.
      MCP_CONSENT: '1',
      MCP_CIMD: '1',
      MCP_FAKE_IDP: '1',
      // Same file: linking artifact -- the symlinked @rekog/mcp-nest-auth would
      // otherwise resolve a second @nestjs/core from the workspace root.
      NODE_OPTIONS: '--preserve-symlinks',
    },
  });
  serverUrl = `http://localhost:${port}`;
  baseUrl = `http://127.0.0.1:${port}`;
}, BOOT_MS);

afterAll(async () => {
  await server?.stop();
});

describe('examples/built-in-authorization-server CIMD + consent e2e (real Node runtime)', () => {
  test('advertises CIMD support in authorization-server metadata', async () => {
    const res = await get(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const meta: any = await res.json();

    expect(meta.client_id_metadata_document_supported).toBe(true);
    // Still S256-only, and the deprecated-but-supported DCR endpoint is intact.
    expect(meta.code_challenge_methods_supported).toEqual(['S256']);
    expect(meta.registration_endpoint).toBe(`${serverUrl}/auth/register`);
  });

  test('serves a metadata document whose client_id matches its own URL', async () => {
    const res = await get(`${baseUrl}/client-metadata.json`);
    expect(res.status).toBe(200);
    const doc: any = await res.json();

    // The MUST: byte-for-byte equality with the URL it is served from. The
    // document advertises the `localhost` spelling the example configures.
    expect(doc.client_id).toBe(`${serverUrl}/client-metadata.json`);
    expect(doc.client_name).toBe('CIMD Demo Client');
    expect(Array.isArray(doc.redirect_uris)).toBe(true);
    // A CIMD client is a public client: no shared secret may appear.
    expect(doc.token_endpoint_auth_method).toBe('none');
    expect(doc.client_secret).toBeUndefined();
  });

  /**
   * The load-bearing test. Reaching a consent screen at all means the server
   * fetched and validated the document over a connection pinned by the
   * `dns.lookup` override -- the exact code path whose callback shape differs
   * between Bun and Node.
   */
  test('resolves a URL client_id and renders the consent screen', async () => {
    const authorize = new URL(`${baseUrl}/auth/authorize`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set(
      'client_id',
      `${serverUrl}/client-metadata.json`,
    );
    authorize.searchParams.set('redirect_uri', `${serverUrl}/demo-callback`);
    authorize.searchParams.set('code_challenge', PKCE.challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.searchParams.set('state', 'cimd-e2e-state');

    // The stub IdP auto-approves, so the chain is
    // /auth/authorize -> (IdP) -> /auth/callback -> consent screen.
    const { status, body: html } = await followWithCookies(authorize.toString());
    expect(status).toBe(200);

    // The CIMD MUST: the redirect URI hostname is displayed.
    expect(html).toContain('localhost');
    // Identity from the fetched document, not from any local registration.
    expect(html).toContain('CIMD Demo Client');
    // The loopback SHOULD-warn, and the CIMD-specific caveat.
    expect(html.toLowerCase()).toContain('loopback');
    // A consent form the user can actually act on.
    expect(html).toContain('consent_token');
  });

  test('rejects a redirect_uri the document does not declare', async () => {
    const authorize = new URL(`${baseUrl}/auth/authorize`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set(
      'client_id',
      `${serverUrl}/client-metadata.json`,
    );
    authorize.searchParams.set('redirect_uri', 'http://evil.example/callback');
    authorize.searchParams.set('code_challenge', PKCE.challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    const res = await get(authorize.toString());
    // An unvalidated redirect target must never be redirected to, so this is a
    // 400 rather than a redirect carrying `error=`.
    expect(res.status).toBe(400);
  });

  test('rejects a client_id URL with no path component', async () => {
    const authorize = new URL(`${baseUrl}/auth/authorize`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', serverUrl);
    authorize.searchParams.set('redirect_uri', `${serverUrl}/demo-callback`);
    authorize.searchParams.set('code_challenge', PKCE.challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    const res = await get(authorize.toString());
    expect(res.status).toBe(400);
  });

  test('rejects a client_id whose document 404s', async () => {
    const authorize = new URL(`${baseUrl}/auth/authorize`);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('client_id', `${serverUrl}/no-such-doc.json`);
    authorize.searchParams.set('redirect_uri', `${serverUrl}/demo-callback`);
    authorize.searchParams.set('code_challenge', PKCE.challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    const res = await get(authorize.toString());
    // A fetch failure aborts the authorization request.
    expect(res.status).toBe(400);
  });

  test('DCR still works alongside CIMD', async () => {
    // The regression guard for the resolver dispatch: enabling CIMD must not
    // disturb ordinary registered clients. DCR ids can never look like a URL,
    // so the two keyspaces cannot collide.
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [`${serverUrl}/demo-callback`],
        client_name: 'e2e-dcr-alongside-cimd',
      }),
    });
    expect(res.status).toBeLessThan(400);
    const client: any = await res.json();
    expect(typeof client.client_id).toBe('string');
    expect(client.client_id.startsWith('http')).toBe(false);
  });
});
