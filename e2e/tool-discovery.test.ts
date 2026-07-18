/**
 * e2e for `examples/tool-discovery` — verifies the behaviors documented in
 * docs/tool-discovery-and-registration.md against a real, spawned example
 * server, driven by a pinned old MCP client.
 *
 * Run:  bun test tool-discovery   (from the e2e/ directory)
 *
 * Green = an old (1.10.0) client can discover and call tools that are
 * registered two different ways:
 *   - automatic discovery: `MyTools` (`@McpController()`) listed directly in
 *     `AppModule.controllers`, exposing `my-tool`.
 *   - grouping via feature modules: `AnalyticsFeatureModule` declares
 *     `AnalyticsTools` as a controller (and `AnalyticsService` as a provider);
 *     `AppModule` only *imports* the feature module (never lists
 *     `AnalyticsTools` directly), and `count-items` must still be discovered
 *     with `AnalyticsService` injected successfully.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createLegacyClient, getFreePort, startExample, type RunningExample } from './harness';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BOOT_MS = 90_000;

let server: RunningExample;
let client: Client;

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('tool-discovery', port, { readyTimeoutMs: BOOT_MS });
  client = await createLegacyClient(server.url);
}, BOOT_MS);

afterAll(async () => {
  await client?.close?.();
  await server?.stop();
});

describe('examples/tool-discovery e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('tools/list advertises tools from both the directly-listed controller and the imported feature module', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['count-items', 'my-tool'].sort());
  });

  test('automatic discovery: directly-listed controller tool is callable', async () => {
    const res = await client.callTool({
      name: 'my-tool',
      arguments: { input: 'hello' },
    });
    expect(text(res)).toBe('hello');
  });

  test('feature-module grouping: tool declared only via an imported module is discovered and its injected provider works', async () => {
    const res = await client.callTool({
      name: 'count-items',
      arguments: { items: ['a', 'b', 'c'] },
    });
    expect(text(res)).toBe('3');
  });

  test('feature-module tool validates its parameters like a directly-listed one', async () => {
    const res: any = await client.callTool({
      name: 'count-items',
      arguments: { items: [] },
    });
    expect(text(res)).toBe('0');
  });
});
