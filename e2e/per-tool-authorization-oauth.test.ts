/**
 * e2e for `examples/per-tool-authorization-oauth` — verifies the behaviors
 * documented in docs/per-tool-authorization-oauth.md against a real, spawned
 * example server, driven by a pinned old MCP client.
 *
 * Run:  bun test per-tool-authorization-oauth.test.ts        (from the e2e/ directory)
 *
 * This example wires the full OAuth authorization server (`McpAuthModule` +
 * `McpAuthJwtGuard`) on an `McpHttpControllerFor(...)` controller, exactly as
 * docs/per-tool-authorization-oauth.md shows. Rather than drive a live GitHub
 * handshake (which needs a real IdP), we run the example's built-in OFFLINE
 * FAKE mode: `MCP_FAKE_AUTH=1` makes it validate identity from locally-minted
 * HS256 JWTs signed with the module's `jwtSecret`. The guard's token check is
 * signature-only (`jwt.verify(token, jwtSecret, { algorithms: ['HS256'] })` in
 * packages/mcp-nest-auth/src/services/jwt-token.service.ts) — no aud/issuer
 * check — so a token minted here with the exact `mintFakeToken` payload shape
 * (src/fake-auth.ts) authenticates just like one printed on server boot.
 *
 * We run in FREEMIUM mode (`ALLOW_UNAUTHENTICATED_ACCESS=true`) so the anonymous
 * path is exercisable: a tokenless caller connects and reaches `@PublicTool()`
 * tools only, while protected/gated tools are filtered from `tools/list` and
 * rejected on `tools/call`. Authenticated identities then exercise the full
 * scope/role matrix via `ToolAuthorizationService` (@ToolScopes / @ToolRoles).
 *
 * Denials surface as `McpError` (JSON-RPC protocol errors) from the server, so
 * the old client rejects the call — asserted with `.rejects.toThrow(...)`. An
 * invalid/badly-signed token is rejected at the HTTP layer (guard 401), which
 * the old client surfaces as a connect-time throw.
 *
 * NOTE: unlike the JWT sibling example, this example's SUPERADMIN user carries
 * roles ['super-admin', 'admin', 'user'] (NO 'premium'), so it can call
 * super-admin-greet but is still denied premium-greet.
 *
 * Green on `main` = an old (1.10.0) client fully interoperates with the OAuth
 * per-tool authorization server. If a server change breaks that, one of these
 * assertions fails and names exactly what regressed.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import { createLegacyClient, getFreePort, startExample, type RunningExample } from './harness';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BOOT_MS = 120_000;

// Must match the JWT_SECRET we pass in the server's env below (>= 32 chars).
const JWT_SECRET = 'e2e-per-tool-authorization-oauth-test-secret-32chars-min';

// Only used to populate the token's resource/aud claims faithfully; the guard
// doesn't validate them, so the exact value is immaterial to authentication.
const RESOURCE = 'http://localhost/mcp';

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface FakeUser {
  sub: string;
  username: string;
  displayName: string;
  scope: string;
  roles: string[];
}

/**
 * Mint an HS256 JWT in the exact shape examples/.../src/fake-auth.ts mintFakeToken
 * produces (jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: '24h' })).
 */
function mintFakeToken(user: FakeUser): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: user.sub,
    type: 'access' as const,
    scope: user.scope,
    resource: RESOURCE,
    aud: RESOURCE,
    user_data: {
      username: user.username,
      displayName: user.displayName,
      roles: user.roles,
    },
    iat: now,
    exp: now + 24 * 60 * 60,
  };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', JWT_SECRET).update(data).digest();
  return `${data}.${base64url(signature)}`;
}

// Same profiles as examples/per-tool-authorization-oauth/src/fake-auth.ts FAKE_USERS.
const BASIC_USER = mintFakeToken({
  sub: 'basic-user',
  username: 'basic',
  displayName: 'Basic User',
  scope: 'read',
  roles: ['user'],
});

const ADMIN_USER = mintFakeToken({
  sub: 'admin-user',
  username: 'admin',
  displayName: 'Admin User',
  scope: 'admin write read',
  roles: ['admin', 'user'],
});

const PREMIUM_USER = mintFakeToken({
  sub: 'premium-user',
  username: 'premium',
  displayName: 'Premium User',
  scope: 'read write',
  roles: ['premium', 'user'],
});

const SUPERADMIN_USER = mintFakeToken({
  sub: 'superadmin-user',
  username: 'superadmin',
  displayName: 'Super Admin User',
  scope: 'admin write delete read',
  roles: ['super-admin', 'admin', 'user'],
});

function bearer(token: string) {
  return { requestInit: { headers: { Authorization: `Bearer ${token}` } } };
}

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

// The @PublicTool() tool and the undecorated (auth-only) tools every logged-in
// user can see, regardless of scopes/roles.
const PUBLIC_TOOL = 'public-greet-world';
const PROTECTED_TOOLS = ['greet-world', 'greet-user', 'greet-logged-in-user'];

let server: RunningExample;
let anonClient: Client;
let basicClient: Client;
let adminClient: Client;
let premiumClient: Client;
let superadminClient: Client;

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('per-tool-authorization-oauth', port, {
    readyTimeoutMs: BOOT_MS,
    env: {
      MCP_FAKE_AUTH: '1',
      JWT_SECRET,
      // Freemium: tokenless callers connect and reach @PublicTool() tools only.
      ALLOW_UNAUTHENTICATED_ACCESS: 'true',
      // LOCAL (file:) linking artifact: @rekog/mcp-nest-auth is symlinked into the
      // example, so Node resolves its `@nestjs/core` from the workspace root while
      // the example resolves its own local copy — two distinct `ModuleRef` classes,
      // which makes McpAuthJwtGuard's `ModuleRef` injection unresolvable at boot.
      // --preserve-symlinks unifies resolution onto the example's copy. Same class
      // of linking-only artifact the harness already sidesteps for ts-node's type
      // checker; harmless to runtime behavior, which is all these tests assert.
      NODE_OPTIONS: '--preserve-symlinks',
    },
  });
  anonClient = await createLegacyClient(server.url);
  basicClient = await createLegacyClient(server.url, bearer(BASIC_USER));
  adminClient = await createLegacyClient(server.url, bearer(ADMIN_USER));
  premiumClient = await createLegacyClient(server.url, bearer(PREMIUM_USER));
  superadminClient = await createLegacyClient(server.url, bearer(SUPERADMIN_USER));
}, BOOT_MS);

afterAll(async () => {
  await anonClient?.close?.();
  await basicClient?.close?.();
  await adminClient?.close?.();
  await premiumClient?.close?.();
  await superadminClient?.close?.();
  await server?.stop();
});

describe('examples/per-tool-authorization-oauth e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test(
    'an invalid/badly-signed token is rejected at the HTTP layer (guard 401)',
    async () => {
      // createLegacyClient retries connect() for ~5s to absorb the "port open but
      // route not yet mounted" boot gap; a permanently-invalid token exhausts that
      // whole retry budget before surfacing, so this needs a longer timeout.
      await expect(
        createLegacyClient(server.url, bearer('not.a.valid-token')),
      ).rejects.toThrow();
    },
    15_000,
  );

  // --- Anonymous (freemium) ------------------------------------------------
  test('anonymous tools/list: only the @PublicTool() tool is visible', async () => {
    const { tools } = await anonClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([PUBLIC_TOOL]);
  });

  test('anonymous can call the public tool', async () => {
    const res = await anonClient.callTool({ name: PUBLIC_TOOL, arguments: {} });
    expect(text(res)).toContain('Public Hello, World!');
  });

  test('anonymous is denied an undecorated (auth-only) tool: requires authentication', async () => {
    await expect(
      anonClient.callTool({ name: 'greet-world', arguments: {} }),
    ).rejects.toThrow(/requires authentication/i);
  });

  test('anonymous is denied a scope-gated tool: requires authentication', async () => {
    await expect(
      anonClient.callTool({ name: 'admin-greet', arguments: { message: 'hi' } }),
    ).rejects.toThrow(/requires authentication/i);
  });

  // --- Basic user (scope: read, roles: [user]) -----------------------------
  test('basic tools/list: public + undecorated protected tools, no gated ones', async () => {
    const { tools } = await basicClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([PUBLIC_TOOL, ...PROTECTED_TOOLS].sort());
  });

  test('basic user can call the undecorated protected tools', async () => {
    const world = await basicClient.callTool({ name: 'greet-world', arguments: {} });
    expect(text(world)).toContain('Hello, World!');

    const named = await basicClient.callTool({
      name: 'greet-user',
      arguments: { name: 'Alice' },
    });
    expect(text(named)).toContain('Hey, Alice!');
  });

  test("basic user's identity flows through @McpRawRequest() to req.user (displayName)", async () => {
    const res = await basicClient.callTool({ name: 'greet-logged-in-user', arguments: {} });
    expect(text(res)).toContain('Hello, Basic User!');
  });

  test('basic user is denied the scope-gated admin tool: requires scopes', async () => {
    await expect(
      basicClient.callTool({ name: 'admin-greet', arguments: { message: 'hi' } }),
    ).rejects.toThrow(/requires scopes/i);
  });

  test('basic user is denied the role-gated premium tool: requires roles', async () => {
    await expect(
      basicClient.callTool({ name: 'premium-greet', arguments: { name: 'Alice' } }),
    ).rejects.toThrow(/requires roles/i);
  });

  // --- Admin user (scope: admin write read, roles: [admin, user]) ----------
  test('admin tools/list: adds admin-greet, not premium-greet or super-admin-greet', async () => {
    const { tools } = await adminClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([PUBLIC_TOOL, ...PROTECTED_TOOLS, 'admin-greet'].sort());
  });

  test('admin user can call the scope-gated admin tool', async () => {
    const res = await adminClient.callTool({
      name: 'admin-greet',
      arguments: { message: 'message from admin' },
    });
    expect(text(res)).toContain('Admin says: message from admin');
  });

  test('admin user is denied the role-gated premium tool: requires roles', async () => {
    await expect(
      adminClient.callTool({ name: 'premium-greet', arguments: { name: 'Alice' } }),
    ).rejects.toThrow(/requires roles/i);
  });

  test('admin user is denied super-admin-greet (has scopes but not super-admin role): requires roles', async () => {
    await expect(
      adminClient.callTool({ name: 'super-admin-greet', arguments: { target: 'server' } }),
    ).rejects.toThrow(/requires roles/i);
  });

  // --- Premium user (scope: read write, roles: [premium, user]) ------------
  test('premium tools/list: adds premium-greet, not admin-greet or super-admin-greet', async () => {
    const { tools } = await premiumClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([PUBLIC_TOOL, ...PROTECTED_TOOLS, 'premium-greet'].sort());
  });

  test('premium user can call the role-gated premium tool', async () => {
    const res = await premiumClient.callTool({
      name: 'premium-greet',
      arguments: { name: 'PremiumX' },
    });
    expect(text(res)).toContain('Premium hello, PremiumX!');
  });

  test('premium user is denied the scope-gated admin tool: requires scopes', async () => {
    await expect(
      premiumClient.callTool({ name: 'admin-greet', arguments: { message: 'hi' } }),
    ).rejects.toThrow(/requires scopes/i);
  });

  // --- Super-admin user (scope: admin write delete read, roles: [super-admin, admin, user]) ---
  test('superadmin tools/list: adds admin-greet + super-admin-greet, but NOT premium-greet (no premium role)', async () => {
    const { tools } = await superadminClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [PUBLIC_TOOL, ...PROTECTED_TOOLS, 'admin-greet', 'super-admin-greet'].sort(),
    );
  });

  test('superadmin user can call the scopes+role-gated super-admin tool', async () => {
    const res = await superadminClient.callTool({
      name: 'super-admin-greet',
      arguments: { target: 'BasicUser' },
    });
    expect(text(res)).toContain('Super-admin acted on BasicUser');
  });

  test('superadmin user is denied the premium tool (lacks premium role): requires roles', async () => {
    await expect(
      superadminClient.callTool({ name: 'premium-greet', arguments: { name: 'Alice' } }),
    ).rejects.toThrow(/requires roles/i);
  });
});
