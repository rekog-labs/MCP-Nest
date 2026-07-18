/**
 * e2e for `examples/custom-controllers` — verifies the two-layer pipeline
 * (HTTP layer vs RPC layer: middleware, interceptors, exception filters)
 * documented in docs/custom-controllers.md against a real, spawned example
 * server, driven by a pinned old MCP client.
 *
 * Run:  bun test custom-controllers   (from the e2e/ directory)
 *
 * Green on `main` = an old (1.10.0) client fully interoperates with the
 * current server's custom controller pipeline. If a future server change
 * breaks how tools/results flow through interceptors and exception filters,
 * one of these assertions fails and names exactly what regressed.
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
  server = await startExample('custom-controllers', port, { readyTimeoutMs: BOOT_MS });
  client = await createLegacyClient(server.url);
}, BOOT_MS);

afterAll(async () => {
  await client?.close?.();
  await server?.stop();
});

describe('examples/custom-controllers e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('tools/list advertises both demo tools', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['boom', 'greet']);
  });

  test('RPC-layer class interceptor tags the result of a successful tool call', async () => {
    const res: any = await client.callTool({ name: 'greet', arguments: { name: 'Ada' } });
    expect(res.isError).toBeFalsy();
    // RpcLoggingInterceptor (class-level, on every tool) appends ' [rpc]' to the
    // returned text — proof the RPC layer ran and could rewrite the result.
    expect(text(res)).toBe('Hello, Ada! [rpc]');
  });

  test('RPC exception filter (extends McpExceptionFilter) surfaces the real thrown message', async () => {
    const res: any = await client.callTool({ name: 'boom', arguments: {} });
    expect(res.isError).toBe(true);
    // Without RpcLoggingExceptionFilter -> McpExceptionFilter, this would arrive
    // as an opaque "Internal server error" instead of the real message.
    expect(text(res)).toContain('intentional failure (RPC layer)');
  });

  test('HTTP-layer interceptor + exception filter: x-demo-fail header short-circuits before MCP decoding', async () => {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'x-demo-fail': 'http',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    // HttpTimingInterceptor throws an HttpException(..., 418) which
    // HttpDemoExceptionFilter catches and shapes as a JSON-RPC-looking error.
    expect(res.status).toBe(418);
    const body = await res.json();
    expect(body).toEqual({
      jsonrpc: '2.0',
      error: {
        code: -32099,
        message: 'Injected HTTP-layer failure (x-demo-fail: http)',
      },
      id: null,
    });
  });

  test('a normal request without the failure header is unaffected by the HTTP filter', async () => {
    // Sanity check that the HTTP-layer pieces are opt-in per request: a plain
    // tool call still goes through the RPC layer as usual.
    const res: any = await client.callTool({ name: 'greet', arguments: { name: 'Bob' } });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toBe('Hello, Bob! [rpc]');
  });
});
