/**
 * e2e for `examples/tool-discovery` — verifies the behaviors documented in
 * docs/tool-discovery-and-registration.md against a real, spawned example
 * server, driven by both a pinned old (1.10.0) and a modern (2026-07-28) client.
 *
 * Run:  bun test tool-discovery   (from the e2e/ directory)
 *
 * Green = both eras can discover and call tools that are
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

import {
  createEraClient,
  ERAS,
  getFreePort,
  startExample,
  type Era,
  type EraClient,
  type RunningExample,
} from './harness';

const BOOT_MS = 90_000;

let server: RunningExample;
const clients: Partial<Record<Era, EraClient>> = {};

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('tool-discovery', port, { readyTimeoutMs: BOOT_MS });
  // One server, both eras: also the dual-era concurrency proof.
  for (const era of ERAS) {
    clients[era] = await createEraClient(era, server.url);
  }
}, BOOT_MS);

afterAll(async () => {
  for (const era of ERAS) await clients[era]?.close();
  await server?.stop();
});

describe.each(ERAS)('examples/tool-discovery e2e (%s era)', (era) => {
  const client = () => clients[era]!;
  test('tools/list advertises tools from both the directly-listed controller and the imported feature module', async () => {
    const { tools } = await client().listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['count-items', 'my-tool'].sort());
  });

  test('automatic discovery: directly-listed controller tool is callable', async () => {
    const res = await client().callTool({
      name: 'my-tool',
      arguments: { input: 'hello' },
    });
    expect(text(res)).toBe('hello');
  });

  test('feature-module grouping: tool declared only via an imported module is discovered and its injected provider works', async () => {
    const res = await client().callTool({
      name: 'count-items',
      arguments: { items: ['a', 'b', 'c'] },
    });
    expect(text(res)).toBe('3');
  });

  test('feature-module tool validates its parameters like a directly-listed one', async () => {
    const res: any = await client().callTool({
      name: 'count-items',
      arguments: { items: [] },
    });
    expect(text(res)).toBe('0');
  });
});
