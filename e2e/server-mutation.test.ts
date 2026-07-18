/**
 * e2e for `examples/server-mutation` — verifies the behaviors documented in
 * docs/server-mutation.md against a real, spawned example server, driven by a
 * pinned old MCP client.
 *
 * Run:  bun test server-mutation.test.ts        (from the e2e/ directory)
 *
 * The example wires a `serverMutator` (`combinedMutator` in
 * examples/server-mutation/src/mutators.ts) that:
 *   - `tracingMutator` wraps `server.server.setRequestHandler` so every
 *     dispatched request (including the decorator-discovered `greet-user`
 *     tool) is timed/logged as `[trace] <method> <span> ok <ms>ms`.
 *   - `loggingMutator` logs `[audit] mcp server session created` once per
 *     server creation (i.e. once per stateful session, at initialize time).
 *
 * The effect is server-side-observable only (console.log), so these tests
 * assert both that the wrapped server still behaves correctly for an old
 * client AND that the harness-captured stdout carries the mutator's trace
 * lines — proving the mutator actually ran and wrapped the decorator tool's
 * dispatch path, not just that some separate instrumentation exists.
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

/**
 * The child's stdout is a pipe, and Node writes to piped stdout
 * asynchronously (unlike a TTY), so a `console.log` inside the server can
 * still be in flight when our HTTP response has already arrived back here.
 * Poll briefly instead of asserting on `server.output()` immediately.
 */
async function waitForOutput(pattern: RegExp | string, timeoutMs = 5_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const out = server.output();
    const matches = typeof pattern === 'string' ? out.includes(pattern) : pattern.test(out);
    if (matches) return out;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for ${pattern} in server output:\n${out}`);
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('server-mutation', port, {});
  client = await createLegacyClient(server.url);
}, BOOT_MS);

afterAll(async () => {
  await client?.close?.();
  await server?.stop();
});

describe('examples/server-mutation e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('tools/list advertises the decorator-discovered tool', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['greet-user']);
  });

  test('serverMutator (loggingMutator) fires once the session is created', async () => {
    // createServer() -- and thus the mutator -- runs at initialize time for a
    // stateful session, which client.connect() has already completed by the
    // time beforeAll resolves.
    await waitForOutput('[audit] mcp server session created');
  });

  test('decorator tool still works end-to-end through the wrapped server', async () => {
    const res = await client.callTool({
      name: 'greet-user',
      arguments: { name: 'Rinor' },
    });
    expect(text(res)).toContain('Hey, Rinor!');
  });

  test('tracingMutator observes the decorator tool call (wraps setRequestHandler)', async () => {
    // The mutator runs before the strategy binds its decorator-tool handlers,
    // so this line proves the wrap covers tools installed after the mutator
    // ran -- the whole point of the instrumentation pattern.
    await waitForOutput(/\[trace\] tools\/call greet-user ok \d+ms/);
  });

  test('tracingMutator observes non-tool-call requests too (span falls back to method)', async () => {
    await client.listTools();
    await waitForOutput(/\[trace\] tools\/list tools\/list ok \d+ms/);
  });

  test('unknown tool call still errors correctly through the mutated dispatch path', async () => {
    await expect(
      client.callTool({ name: 'does-not-exist', arguments: {} }),
    ).rejects.toThrow();
  });
});
