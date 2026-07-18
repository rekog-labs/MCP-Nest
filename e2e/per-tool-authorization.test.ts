/**
 * e2e for `examples/per-tool-authorization` — verifies the behaviors documented
 * in docs/per-tool-authorization.md against a real, spawned example server,
 * driven by a pinned old MCP client.
 *
 * Run:  bun test per-tool-authorization   (from the e2e/ directory)
 *
 * The example wires an `AuthGuard` (src/auth.guard.ts) on the MCP HTTP
 * controller that verifies a `Bearer <jwt>` header and, if valid, sets
 * `req.user` to the decoded payload; the `ToolAuthorizationService` then
 * filters `tools/list` and rejects `tools/call` based on `@PublicTool()`,
 * `@ToolScopes()` and `@ToolRoles()`. We run the server with FREEMIUM=true
 * (allowUnauthenticatedAccess) so an anonymous caller is let in by the guard
 * and can be used to exercise the "no user" path — in the default (non-
 * freemium) mode the guard 401s every tokenless request, including
 * `initialize`, so an anonymous client couldn't even connect.
 *
 * Tokens are minted the same way the example's README documents
 * (`src/mint-token.ts <profile>`), signed with the dev secret the guard
 * verifies against (src/jwt-secret.ts) — three profiles:
 *   - admin:  scopes [admin, write, read] · roles [admin, user]
 *   - basic:  scopes [read]               · roles [user]
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { createLegacyClient, getFreePort, startExample, type RunningExample } from './harness';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BOOT_MS = 90_000;
const EXAMPLE_DIR = join(import.meta.dir, '..', 'examples', 'per-tool-authorization');

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

/** Mint a local JWT for one of the example's three profiles via its own script. */
function mintToken(profile: 'admin' | 'basic' | 'premium'): string {
  const res = spawnSync('npx', ['ts-node', '--transpile-only', 'src/mint-token.ts', profile], {
    cwd: EXAMPLE_DIR,
    encoding: 'utf8',
  });
  if (res.status !== 0) {
    throw new Error(`mint-token failed for "${profile}":\n${res.stderr}`);
  }
  return res.stdout.trim();
}

let server: RunningExample;
let anon: Client;
let basic: Client;
let admin: Client;

beforeAll(async () => {
  const port = await getFreePort();
  // Freemium mode: the guard lets tokenless callers through (no req.user), so
  // we can exercise both the anonymous and the authenticated paths against a
  // single server instance.
  server = await startExample('per-tool-authorization', port, {
    readyTimeoutMs: BOOT_MS,
    env: { FREEMIUM: 'true' },
  });

  const basicToken = mintToken('basic');
  const adminToken = mintToken('admin');

  anon = await createLegacyClient(server.url);
  basic = await createLegacyClient(server.url, {
    requestInit: { headers: { Authorization: `Bearer ${basicToken}` } },
  });
  admin = await createLegacyClient(server.url, {
    requestInit: { headers: { Authorization: `Bearer ${adminToken}` } },
  });
}, BOOT_MS);

afterAll(async () => {
  await anon?.close?.();
  await basic?.close?.();
  await admin?.close?.();
  await server?.stop();
});

describe('examples/per-tool-authorization e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('anonymous caller only sees the @PublicTool() tool', async () => {
    const { tools } = await anon.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['public-search']);
  });

  test('anonymous caller can call the public tool', async () => {
    const res = await anon.callTool({ name: 'public-search', arguments: { query: 'nest' } });
    expect(text(res)).toContain('Public search results for: nest');
  });

  test('anonymous caller is rejected from a protected tool (protocol error)', async () => {
    await expect(anon.callTool({ name: 'user-profile', arguments: {} })).rejects.toThrow(
      "Tool 'user-profile' requires authentication",
    );
  });

  test('anonymous caller is rejected from a scope-gated tool (protocol error)', async () => {
    await expect(
      anon.callTool({ name: 'admin-delete', arguments: { userId: 'u1' } }),
    ).rejects.toThrow("Tool 'admin-delete' requires authentication");
  });

  test('anonymous caller is rejected from a role-gated tool (protocol error)', async () => {
    await expect(anon.callTool({ name: 'system-config', arguments: {} })).rejects.toThrow(
      "Tool 'system-config' requires authentication",
    );
  });

  test('authenticated caller without required scopes/roles sees only public + protected tools', async () => {
    const { tools } = await basic.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['public-search', 'user-profile']);
  });

  test('authenticated caller can call the plain protected tool', async () => {
    const res = await basic.callTool({ name: 'user-profile', arguments: {} });
    expect(text(res)).toContain('Profile for Basic User');
  });

  test('caller lacking required scopes is denied the scope-gated tool', async () => {
    await expect(
      basic.callTool({ name: 'admin-delete', arguments: { userId: 'u1' } }),
    ).rejects.toThrow("Tool 'admin-delete' requires scopes: admin, write");
  });

  test('caller lacking required role is denied the role-gated tool', async () => {
    await expect(basic.callTool({ name: 'system-config', arguments: {} })).rejects.toThrow(
      "Tool 'system-config' requires roles: admin",
    );
  });

  test('admin caller (matching scopes + role) sees every tool', async () => {
    const { tools } = await admin.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'admin-delete',
      'public-search',
      'system-config',
      'user-profile',
    ]);
  });

  test('admin caller can call the scope-gated tool', async () => {
    const res = await admin.callTool({ name: 'admin-delete', arguments: { userId: 'u1' } });
    expect(text(res)).toContain('User u1 deleted');
  });

  test('admin caller can call the role-gated tool', async () => {
    const res = await admin.callTool({ name: 'system-config', arguments: {} });
    expect(text(res)).toContain('System configured');
  });
});
