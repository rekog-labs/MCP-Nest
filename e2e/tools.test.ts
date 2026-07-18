/**
 * e2e for `examples/tools` — verifies the behaviors documented in docs/tools.md
 * against a real, spawned example server, driven by a pinned old MCP client.
 *
 * Run:  bun test tools        (from the e2e/ directory)
 *
 * Green on `main` = an old (1.10.0) client fully interoperates with the current
 * server. If the v1->v2 SDK migration (or any future server change) breaks that,
 * one of these assertions fails and names exactly what regressed.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { createLegacyClient, getFreePort, startExample, type RunningExample } from './harness';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BOOT_MS = 90_000;

let server: RunningExample;
let client: Client;

/** Permissive schema: read the raw wire result without the old client's strict parsing. */
const WireResult = z.object({}).passthrough();

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

// NOTE: mcp-nest currently JSON-stringifies a plain-string tool return, so the
// text content of those tools arrives quoted (`"\"Salut, Alice!\""`). We assert
// on the substantive content (toContain) rather than the exact serialized form,
// so these stay about behavior, not serialization trivia. The protocol-level
// checks below (list/structured/errors) use exact assertions.

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('tools', port, { readyTimeoutMs: BOOT_MS });
  client = await createLegacyClient(server.url);
}, BOOT_MS);

afterAll(async () => {
  await client?.close?.();
  await server?.stop();
});

describe('examples/tools e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('tools/list advertises every documented tool', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'admin-action',
        'boom',
        'greet-user',
        'greet-user-interactive',
        'greet-user-meta',
        'greet-user-structured',
        'inspect-request',
        'log-demo',
        'my-tool',
        'process-data',
        'secure-action',
        'throw-plain',
        'throw-rpc',
        'whoami',
      ].sort(),
    );
  });

  test('@Tool({ _meta }) passthrough survives to tools/list', async () => {
    const { tools } = await client.listTools();
    const meta = tools.find((t) => t.name === 'greet-user-meta')?._meta;
    expect(meta?.['example.com/category']).toBe('greeting');
    expect(meta?.['example.com/version']).toBe(2);
  });

  test('basic tool call returns a localized greeting', async () => {
    const res = await client.callTool({
      name: 'greet-user',
      arguments: { name: 'Alice', language: 'fr' },
    });
    expect(text(res)).toContain('Salut, Alice!');
  });

  test('output schema -> structuredContent on the wire', async () => {
    const res: any = await client.request(
      { method: 'tools/call', params: { name: 'greet-user-structured', arguments: { name: 'Charlie', language: 'fr' } } },
      WireResult,
    );
    expect(res.structuredContent).toBeDefined();
    expect(res.structuredContent.languageName).toBe('English');
    expect(res.structuredContent.language).toBe('fr');
  });

  test('progress notifications reach an old client', async () => {
    const progress: number[] = [];
    const res = await client.callTool(
      { name: 'process-data', arguments: { data: 'payload' } },
      undefined,
      { onprogress: (p: any) => progress.push(p.progress) },
    );
    expect(text(res)).toContain('Processed: payload');
    expect(progress.length).toBeGreaterThan(0);
  });

  test('@McpRawRequest() exposes transport request headers', async () => {
    const res = await client.callTool({ name: 'whoami', arguments: {} });
    expect(text(res)).toContain('user-agent:');
  });

  test('ctx.mcpRequest reflects the JSON-RPC method', async () => {
    const res = await client.callTool({ name: 'inspect-request', arguments: { input: 'hi' } });
    expect(text(res)).toContain('method=tools/call');
  });

  test('_meta-carrying tool still executes normally', async () => {
    const res = await client.callTool({ name: 'greet-user-meta', arguments: { name: 'Bob' } });
    expect(text(res)).toContain('Hey, Bob!');
  });

  test('tool guard denial surfaces as isError (no user on request)', async () => {
    const res: any = await client.callTool({ name: 'admin-action', arguments: { target: 'server' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Forbidden');
  });

  test('method-level @UseFilters maps a custom error', async () => {
    const res: any = await client.callTool({ name: 'boom', arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('[BOOM] kaboom');
  });

  test('plain Error is masked, RpcException is surfaced', async () => {
    const plain: any = await client.callTool({ name: 'throw-plain', arguments: {} });
    expect(plain.isError).toBe(true);
    expect(text(plain)).not.toContain('super secret internal detail');

    const rpc: any = await client.callTool({ name: 'throw-rpc', arguments: {} });
    expect(rpc.isError).toBe(true);
    expect(text(rpc)).toContain('actionable client-facing message');
  });

  test('filters on a resource surface a protocol error', async () => {
    await expect(client.readResource({ uri: 'mcp://my-resource' })).rejects.toThrow();
  });

  test('filters on a prompt surface a protocol error', async () => {
    await expect(client.getPrompt({ name: 'my-prompt' })).rejects.toThrow();
  });
});
