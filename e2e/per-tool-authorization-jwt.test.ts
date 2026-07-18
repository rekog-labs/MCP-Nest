/**
 * e2e for `examples/per-tool-authorization-jwt` — verifies the behaviors
 * documented in docs/per-tool-authorization-jwt.md against a real, spawned
 * example server, driven by a pinned old MCP client.
 *
 * Run:  bun test per-tool-authorization-jwt.test.ts        (from the e2e/ directory)
 *
 * The example wires a hand-rolled `SimpleJwtGuard` (src/simple-jwt.guard.ts) on
 * the MCP HTTP controller in freemium mode (`allowUnauthenticatedAccess: true`):
 * a tokenless request is let through with no `req.user` (so it can still reach
 * `@PublicTool()` tools), a request with a syntactically-valid-but-badly-signed
 * token is rejected outright at the HTTP layer (guard returns false -> 403,
 * which the old client surfaces as a connect-time throw), and a request with a
 * validly-signed token gets `req.user` populated from the JWT payload, which
 * `ToolAuthorizationService` then uses to filter `tools/list` and gate
 * `tools/call` by `@ToolScopes()` / `@ToolRoles()`.
 *
 * Tokens are minted in-process with the exact same signing recipe as
 * `examples/per-tool-authorization-jwt/scripts/mint-jwts.ts` (HS256 over the
 * same claim shape: `scope` space-delimited string + `scopes` array + `roles`
 * array), using Node's built-in `node:crypto` so this test needs no extra
 * dependency. The signing secret is passed to the server via `startExample`'s
 * `env` so client-minted tokens and server-side verification agree.
 *
 * Green on `main` = an old (1.10.0) client fully interoperates with per-tool
 * JWT authorization. If a server change breaks that, one of these assertions
 * fails and names exactly what regressed.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';

import { createLegacyClient, getFreePort, startExample, type RunningExample } from './harness';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BOOT_MS = 90_000;

// Must match what we pass as JWT_SECRET in the server's env below.
const JWT_SECRET = 'e2e-per-tool-authorization-jwt-test-secret-32chars-min';

function base64url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Mint an HS256 JWT the same way scripts/mint-jwts.ts does (jwt.sign(payload, JWT_SECRET)). */
function sign(payload: Record<string, unknown>): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { iat: Math.floor(Date.now() / 1000), ...payload };
  const data = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(body))}`;
  const signature = createHmac('sha256', JWT_SECRET).update(data).digest();
  return `${data}.${base64url(signature)}`;
}

// Same claim shapes as scripts/mint-jwts.ts's BASIC_USER / ADMIN_USER / PREMIUM_USER / SUPERADMIN_USER.
const BASIC_USER = sign({
  sub: 'user123',
  name: 'Basic User',
  username: 'basicuser',
  displayName: 'Basic User',
});

const ADMIN_USER = sign({
  sub: 'admin456',
  name: 'Admin User',
  username: 'admin',
  displayName: 'Admin User',
  scope: 'admin write read',
  scopes: ['admin', 'write', 'read'],
  roles: ['admin'],
});

const PREMIUM_USER = sign({
  sub: 'premium789',
  name: 'Premium User',
  username: 'premiumuser',
  displayName: 'Premium User',
  scope: 'read write',
  scopes: ['read', 'write'],
  roles: ['premium'],
});

const SUPERADMIN_USER = sign({
  sub: 'superadmin000',
  name: 'Super Admin',
  username: 'superadmin',
  displayName: 'Super Admin',
  scope: 'admin write delete read',
  scopes: ['admin', 'write', 'delete', 'read'],
  roles: ['super-admin', 'admin', 'premium'],
});

function bearer(token: string) {
  return { requestInit: { headers: { Authorization: `Bearer ${token}` } } };
}

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

let server: RunningExample;
let anonClient: Client;
let basicClient: Client;
let adminClient: Client;
let premiumClient: Client;
let superadminClient: Client;

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('per-tool-authorization-jwt', port, {
    readyTimeoutMs: BOOT_MS,
    env: { JWT_SECRET },
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

describe('examples/per-tool-authorization-jwt e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test(
    'an invalid/unsigned token is rejected at the HTTP layer (guard returns false)',
    async () => {
      // createLegacyClient retries connect() for ~5s to absorb the "port open but
      // route not yet mounted" boot gap; a permanently-invalid token exhausts
      // that whole retry budget before surfacing, so this needs a longer timeout
      // than the default 5s test timeout.
      await expect(
        createLegacyClient(server.url, bearer('not.a.validtoken')),
      ).rejects.toThrow();
    },
    10_000,
  );

  test('anonymous tools/list: only the @PublicTool() tool is visible', async () => {
    const { tools } = await anonClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['public-greet-world']);
  });

  test('anonymous can call the public tool', async () => {
    const res = await anonClient.callTool({ name: 'public-greet-world', arguments: {} });
    expect(text(res)).toContain('Public Hello, World!');
  });

  test('anonymous is denied an undecorated (protected) tool: requires authentication', async () => {
    await expect(
      anonClient.callTool({ name: 'greet-world', arguments: {} }),
    ).rejects.toThrow(/requires authentication/i);
  });

  test('anonymous is denied a scope/role-gated tool: requires authentication', async () => {
    await expect(
      anonClient.callTool({
        name: 'admin-greet',
        arguments: { message: 'hi' },
      }),
    ).rejects.toThrow(/requires authentication/i);
  });

  test('basic (authenticated, no scopes/roles) tools/list: public + undecorated protected tools, no gated ones', async () => {
    const { tools } = await basicClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      ['public-greet-world', 'greet-world', 'greet-user', 'greet-logged-in-user'].sort(),
    );
  });

  test('basic user can call undecorated protected tools', async () => {
    const world = await basicClient.callTool({ name: 'greet-world', arguments: {} });
    expect(text(world)).toContain('Hello, World!');

    const named = await basicClient.callTool({
      name: 'greet-user',
      arguments: { name: 'Alice' },
    });
    expect(text(named)).toContain('Hello, Alice!');
  });

  test("basic user's identity flows through @McpRawRequest() to req.user", async () => {
    const res = await basicClient.callTool({ name: 'greet-logged-in-user', arguments: {} });
    expect(text(res)).toContain('Hello, Basic User!');
  });

  test('basic user is denied the admin-scoped tool: requires scopes', async () => {
    await expect(
      basicClient.callTool({
        name: 'admin-greet',
        arguments: { message: 'hi' },
      }),
    ).rejects.toThrow(/requires scopes/i);
  });

  test('basic user is denied the premium-role tool: requires roles', async () => {
    await expect(
      basicClient.callTool({
        name: 'premium-greet',
        arguments: { name: 'Alice', level: 'gold' },
      }),
    ).rejects.toThrow(/requires roles/i);
  });

  test('admin user tools/list: sees admin-greet, not premium-greet or super-admin-greet', async () => {
    const { tools } = await adminClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'public-greet-world',
        'greet-world',
        'greet-user',
        'greet-logged-in-user',
        'admin-greet',
      ].sort(),
    );
  });

  test('admin user can call the admin-scoped tool', async () => {
    const res = await adminClient.callTool({
      name: 'admin-greet',
      arguments: { message: 'message from admin' },
    });
    expect(text(res)).toContain('Admin Greeting: message from admin (from Admin User)');
  });

  test('admin user is denied the premium-role tool: requires roles', async () => {
    await expect(
      adminClient.callTool({
        name: 'premium-greet',
        arguments: { name: 'Alice', level: 'gold' },
      }),
    ).rejects.toThrow(/requires roles/i);
  });

  test('premium user tools/list: sees premium-greet, not admin-greet or super-admin-greet', async () => {
    const { tools } = await premiumClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'public-greet-world',
        'greet-world',
        'greet-user',
        'greet-logged-in-user',
        'premium-greet',
      ].sort(),
    );
  });

  test('premium user can call the premium-role tool', async () => {
    const res = await premiumClient.callTool({
      name: 'premium-greet',
      arguments: { name: 'PremiumX', level: 'gold' },
    });
    expect(text(res)).toContain('Premium gold greeting: Hello PremiumX! (from Premium User)');
  });

  test('premium user is denied the admin-scoped tool: requires scopes', async () => {
    await expect(
      premiumClient.callTool({
        name: 'admin-greet',
        arguments: { message: 'hi' },
      }),
    ).rejects.toThrow(/requires scopes/i);
  });

  test('superadmin user tools/list: sees every tool', async () => {
    const { tools } = await superadminClient.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'public-greet-world',
        'greet-world',
        'greet-user',
        'greet-logged-in-user',
        'admin-greet',
        'premium-greet',
        'super-admin-greet',
      ].sort(),
    );
  });

  test('superadmin user can call the scopes+role-gated tool', async () => {
    const res = await superadminClient.callTool({
      name: 'super-admin-greet',
      arguments: { target: 'BasicUser', action: 'approve' },
    });
    expect(text(res)).toContain('SUPER ADMIN: approve BasicUser by Super Admin');
  });
});
