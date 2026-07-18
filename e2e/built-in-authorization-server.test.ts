/**
 * e2e for `examples/built-in-authorization-server` — verifies the OFFLINE/FAKE
 * auth path documented in the example's README ("FAKE mode, MCP_FAKE_AUTH=1")
 * and docs/built-in-authorization-server.md, against a real, spawned example
 * server, driven by a pinned old MCP client.
 *
 * Run:  bun test built-in-authorization-server.test.ts     (from the e2e/ directory)
 *
 * The example runs `McpAuthModule` — a full OAuth 2.1 Authorization Server —
 * mounting the discovery / dynamic-client-registration / authorize / token
 * endpoints (under `apiPrefix: 'auth'`, well-known at root) while the `/mcp`
 * Streamable-HTTP controller is protected by `McpAuthJwtGuard`. In FAKE mode
 * (`MCP_FAKE_AUTH=1`) dummy GitHub creds let the module construct without ever
 * contacting an IdP, and the offline shortcut to a usable token is a JWT signed
 * locally with the SAME `jwtSecret` the server uses: `JwtTokenService.validateToken`
 * only HS256-verifies the signature (no aud/iss/interactive-flow check), so a
 * client-minted token is accepted by the `/mcp` guard exactly like a token the
 * AS would have issued via the browser leg — which is genuinely not runnable
 * offline. This mirrors `scripts/mint-jwt.ts`.
 *
 * The pinned client (1.10.0) authenticates purely via the HTTP `Authorization`
 * header on the transport (`requestInit.headers`), never a browser OAuth flow.
 *
 * Green = an old (1.10.0) client fully interoperates with the built-in OAuth
 * authorization server (metadata discovery + Bearer-gated MCP). If a server
 * change breaks that, one of these assertions fails and names what regressed.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import {
  createLegacyClient,
  getFreePort,
  startExample,
  type RunningExample,
} from './harness';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BOOT_MS = 120_000;
const EXAMPLE = 'built-in-authorization-server';

// Must match the JWT_SECRET we pass to the server's env below, so a
// locally-minted token verifies against the server's JwtTokenService.
const JWT_SECRET = 'e2e-built-in-authorization-server-secret-32chars-min';

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Mint an HS256 access token the same way scripts/mint-jwt.ts does
 * (jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '1h' })),
 * using node:crypto so this test needs no extra dependency.
 */
function signAccessToken(serverUrl: string): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = {
    sub: 'local-test-user',
    type: 'access',
    displayName: 'Ada Lovelace',
    scope: '',
    resource: `${serverUrl}/mcp`,
    iss: serverUrl,
    aud: `${serverUrl}/mcp`,
    iat: now,
    exp: now + 3600,
  };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const signature = createHmac('sha256', JWT_SECRET).update(data).digest();
  return `${data}.${base64url(signature)}`;
}

function bearer(token: string) {
  return { requestInit: { headers: { Authorization: `Bearer ${token}` } } };
}

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

let server: RunningExample;
let authedClient: Client;
let serverUrl: string; // the AS's own advertised base URL, derived from PORT
let baseUrl: string; // http://127.0.0.1:<port> — what we actually fetch/connect to

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample(EXAMPLE, port, {
    readyTimeoutMs: BOOT_MS,
    env: {
      MCP_FAKE_AUTH: '1',
      JWT_SECRET,
      // In LOCAL (file:) mode the symlinked @rekog/mcp-nest-auth otherwise resolves
      // a second @nestjs/core from the workspace root, giving two ModuleRef tokens
      // and an unresolvable McpAuthJwtGuard dependency. --preserve-symlinks unifies
      // resolution onto the example's own copy. No-op in published mode.
      NODE_OPTIONS: '--preserve-symlinks',
    },
  });
  // The example derives its own serverUrl (issuer) from PORT as
  // `http://localhost:${PORT}`; we connect over the loopback IP the harness uses.
  serverUrl = `http://localhost:${port}`;
  baseUrl = `http://127.0.0.1:${port}`;

  authedClient = await createLegacyClient(server.url, bearer(signAccessToken(serverUrl)));
}, BOOT_MS);

afterAll(async () => {
  await authedClient?.close?.();
  await server?.stop();
});

describe('examples/built-in-authorization-server e2e (FAKE mode, pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('serves OAuth authorization-server metadata (RFC 8414 discovery)', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`);
    expect(res.status).toBe(200);
    const meta: any = await res.json();

    expect(meta.issuer).toBe(serverUrl);
    expect(meta.authorization_endpoint).toBe(`${serverUrl}/auth/authorize`);
    expect(meta.token_endpoint).toBe(`${serverUrl}/auth/token`);
    expect(meta.registration_endpoint).toBe(`${serverUrl}/auth/register`);
    expect(meta.response_types_supported).toEqual(['code']);
    expect(meta.grant_types_supported).toContain('authorization_code');
    // PKCE advertised per the README.
    expect(meta.code_challenge_methods_supported).toEqual(['plain', 'S256']);
  });

  test('serves OAuth protected-resource metadata (RFC 9728) pointing at the AS + /mcp', async () => {
    const res = await fetch(`${baseUrl}/.well-known/oauth-protected-resource`);
    expect(res.status).toBe(200);
    const meta: any = await res.json();

    expect(meta.authorization_servers).toContain(serverUrl);
    expect(meta.resource).toBe(`${serverUrl}/mcp`);
    expect(meta.bearer_methods_supported).toEqual(['header']);
    expect(meta.mcp_versions_supported).toContain('2025-06-18');
  });

  test('Dynamic Client Registration (RFC 7591) returns a registered client', async () => {
    const res = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: ['http://localhost/callback'],
        client_name: 'e2e-legacy-client',
      }),
    });
    expect(res.status).toBeLessThan(400);
    const client: any = await res.json();
    expect(typeof client.client_id).toBe('string');
    expect(client.client_id.length).toBeGreaterThan(0);
  });

  test('an unauthenticated client is rejected at the guarded /mcp endpoint (401)', async () => {
    // No Authorization header -> McpAuthJwtGuard throws UnauthorizedException,
    // which the old client surfaces as a connect-time throw. The retry budget in
    // createLegacyClient (~5s) is exhausted on a permanently-401 endpoint, so
    // this needs a longer-than-default timeout.
    await expect(createLegacyClient(server.url)).rejects.toThrow();
  }, 15_000);

  test('a malformed/wrong-secret Bearer token is rejected at /mcp (401)', async () => {
    await expect(
      createLegacyClient(server.url, bearer('not.a.validtoken')),
    ).rejects.toThrow();
  }, 15_000);

  test('an authenticated client can list the MCP tool', async () => {
    const { tools } = await authedClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['whoami']);
  });

  test('an authenticated client can call the tool; @McpUser() projects the JWT identity', async () => {
    const res = await authedClient.callTool({ name: 'whoami', arguments: {} });
    expect(text(res)).toContain('Hello, Ada Lovelace!');
  });
});
