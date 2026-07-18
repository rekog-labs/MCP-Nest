/**
 * e2e for `examples/dependency-injection` — verifies the behaviors documented
 * in docs/dependency-injection.md against a real, spawned example server,
 * driven by a pinned old MCP client.
 *
 * Run:  bun test dependency-injection.test.ts        (from the e2e/ directory)
 *
 * Green on `main` = an old (1.10.0) client fully interoperates with the current
 * server. If the v1->v2 SDK migration (or any future server change) breaks that,
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
  server = await startExample('dependency-injection', port, { readyTimeoutMs: BOOT_MS });
  client = await createLegacyClient(server.url);
}, BOOT_MS);

afterAll(async () => {
  await client?.close?.();
  await server?.stop();
});

describe('examples/dependency-injection e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('tools/list advertises every documented tool', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['hello-world', 'inspect-request'].sort());
  });

  test('resources/list advertises the injected-repository resource', async () => {
    const { resources } = await client.listResources();
    const byUri = Object.fromEntries(resources.map((r) => [r.uri, r]));
    expect(Object.keys(byUri)).toEqual(['mcp://users/world']);
    expect(byUri['mcp://users/world']).toMatchObject({
      name: 'user-directory',
      description: 'Looks up a user via the injected UserRepository',
      mimeType: 'application/json',
    });
  });

  test('prompts/list advertises the injected-repository prompt', async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name);
    expect(names).toEqual(['greet-known-user']);
    const prompt = prompts.find((p) => p.name === 'greet-known-user');
    expect(prompt?.description).toBe(
      'Builds a greeting prompt using data from the injected UserRepository',
    );
    expect(prompt?.arguments).toEqual([{ name: 'name', required: true }]);
  });

  test('constructor-injected singleton service resolves a known user', async () => {
    const res = await client.callTool({
      name: 'hello-world',
      arguments: { name: 'World' },
    });
    expect(text(res)).toContain('Hello, World! (world@example.com)');
  });

  test('constructor-injected singleton service is shared across calls (same data)', async () => {
    const res = await client.callTool({
      name: 'hello-world',
      arguments: { name: 'Alice' },
    });
    expect(text(res)).toContain('Hello, Alice! (alice@example.com)');
  });

  test('constructor-injected service reports a miss for unknown users', async () => {
    const res = await client.callTool({
      name: 'hello-world',
      arguments: { name: 'Zork' },
    });
    expect(text(res)).toContain('No user found for "Zork"');
  });

  test('resource handler uses the same injected UserRepository', async () => {
    const res = await client.readResource({ uri: 'mcp://users/world' });
    expect(res.contents).toHaveLength(1);
    const content = res.contents[0] as { uri: string; mimeType: string; text: string };
    expect(content.uri).toBe('mcp://users/world');
    expect(content.mimeType).toBe('application/json');
    expect(JSON.parse(content.text)).toEqual({
      name: 'World',
      email: 'world@example.com',
    });
  });

  test('prompt handler uses the same injected UserRepository (known user)', async () => {
    const res = await client.getPrompt({
      name: 'greet-known-user',
      arguments: { name: 'Alice' },
    });
    expect(res.description).toBe('Greet a known user');
    expect(res.messages).toEqual([
      {
        role: 'user',
        content: {
          type: 'text',
          text: 'Greet Alice whose email is alice@example.com',
        },
      },
    ]);
  });

  test('prompt handler falls back gracefully for an unknown user', async () => {
    const res = await client.getPrompt({
      name: 'greet-known-user',
      arguments: { name: 'Ghost' },
    });
    expect(res.messages).toEqual([
      {
        role: 'user',
        content: {
          type: 'text',
          text: 'Greet an unknown user named Ghost',
        },
      },
    ]);
  });

  test('request-scoped controller: @Inject(REQUEST) is a wrapper, not McpContext directly', async () => {
    const res = await client.callTool({ name: 'inspect-request', arguments: {} });
    const payload = JSON.parse(text(res));

    // @Inject(REQUEST) resolves to a RequestContextHost-style wrapper, NOT the
    // McpContext itself: it does not expose getRawRequest() directly...
    expect(payload.injectedRequestIsRpcContext).toBe(false);
    // ...but it does expose .getContext(), one call away from the real McpContext.
    expect(payload.injectedRequestHasGetContext).toBe(true);
    expect(payload.viaGetContext_hasGetRawRequest).toBe(true);
  });

  test('request-scoped controller: @McpRawRequest() exposes the raw HTTP request directly', async () => {
    const res = await client.callTool({ name: 'inspect-request', arguments: {} });
    const payload = JSON.parse(text(res));

    expect(payload.rawRequestHasHeaders).toBe(true);
    expect(typeof payload.rawRequestUserAgent).toBe('string');
    // Both routes into the request (the wrapper's .getContext().getRawRequest()
    // and the @McpRawRequest() decorator) must agree on the same underlying request.
    expect(payload.viaGetContext_userAgent).toBe(payload.rawRequestUserAgent);
  });

  test('getting an unknown prompt name still rejects (protocol-level, not DI-specific)', async () => {
    await expect(client.getPrompt({ name: 'does-not-exist' })).rejects.toThrow();
  });
});
