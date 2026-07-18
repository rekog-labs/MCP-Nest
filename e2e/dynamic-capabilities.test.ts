/**
 * e2e for `examples/dynamic-capabilities` — verifies the behaviors documented
 * in docs/dynamic-capabilities.md against a real, spawned example server,
 * driven by a pinned old MCP client.
 *
 * Run:  bun test dynamic-capabilities.test.ts        (from the e2e/ directory)
 *
 * The example (`src/main.ts`) wires:
 *   - `DynamicCapabilitiesService` (OnModuleInit) — registers tools/resources/
 *     prompts on the main `mcp` strategy, including entries that are removed
 *     before the server ever serves a request (`gone-tool`/`gone-resource`/
 *     `gone-prompt`) and one removed then re-registered with a new handler
 *     (`my-tool`, v1 -> "Updated version").
 *   - `StaticTools` (`@McpController`) — a decorator-based `static-tool`
 *     alongside the dynamic ones (mixed mode).
 *   - `ExternalCapabilitiesService`, in a separate `ExternalModule` that only
 *     imports `ServerModule` to inject the shared `MCP_STRATEGY` — registers
 *     `external-tool`.
 *   - `MultiServerModule` (`src/multi-server.ts`) — two extra `McpStrategy`
 *     instances (`server-a`, `server-b`) mounted at `/server-a/mcp` and
 *     `/server-b/mcp`; only server A gets a dynamically registered tool
 *     (`server-a-tool`), proving per-strategy isolation.
 *
 * Green on `main` = an old (1.10.0) client fully interoperates with dynamic
 * capability registration/deregistration. If the v1->v2 SDK migration (or any
 * future server change) breaks that, one of these assertions fails and names
 * exactly what regressed.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { createLegacyClient, getFreePort, startExample, type RunningExample } from './harness';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';

const BOOT_MS = 90_000;

let server: RunningExample;
let client: Client;
let clientA: Client;
let clientB: Client;

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('dynamic-capabilities', port, { readyTimeoutMs: BOOT_MS });
  client = await createLegacyClient(server.url);
  clientA = await createLegacyClient(`http://127.0.0.1:${server.port}/server-a/mcp`);
  clientB = await createLegacyClient(`http://127.0.0.1:${server.port}/server-b/mcp`);
}, BOOT_MS);

afterAll(async () => {
  await client?.close?.();
  await clientA?.close?.();
  await clientB?.close?.();
  await server?.stop();
});

describe('examples/dynamic-capabilities e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('tools/list on the main endpoint reflects static + dynamic + external tools, minus removed/gated ones', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    // 'gone-tool' was registered then removed before the server ever serves
    // (deregistration). 'admin-operation' has requiredScopes/requiredRoles
    // but this example wires no guard to set request.user, so the strategy's
    // own authorization filtering hides it from an anonymous caller.
    expect(names).toEqual(
      [
        'static-tool',
        'search-knowledge',
        'search-collection',
        'public-search',
        'external-tool',
        'dynamic-tool',
        'my-tool',
      ].sort(),
    );
  });

  test('re-registration after removal uses the new handler (my-tool v1 -> updated)', async () => {
    const { tools } = await client.listTools();
    const myTool = tools.find((t) => t.name === 'my-tool');
    expect(myTool?.description).toBe('Updated version');

    const res = await client.callTool({ name: 'my-tool', arguments: {} });
    expect(text(res)).toContain('new result');
    expect(text(res)).not.toContain('old result');
  });

  test('calling a removed-and-never-re-registered tool errors (MethodNotFound)', async () => {
    await expect(client.callTool({ name: 'gone-tool', arguments: {} })).rejects.toThrow(
      /gone-tool/i,
    );
  });

  test('dynamic tool loaded like from a database interpolates config into its result', async () => {
    const res = await client.callTool({
      name: 'search-knowledge',
      arguments: { query: 'hello' },
    });
    expect(text(res)).toContain('Results for: hello');
  });

  test('dynamic tool with an enum built from runtime data validates and executes', async () => {
    const res = await client.callTool({
      name: 'search-collection',
      arguments: { query: 'widgets', collection: 'docs' },
    });
    expect(text(res)).toContain('"collection":"docs"');
    expect(text(res)).toContain('"query":"widgets"');
  });

  test('isPublic dynamic tool is reachable without a user', async () => {
    const res = await client.callTool({ name: 'public-search', arguments: {} });
    expect(text(res)).toContain('Results...');
  });

  test('requiredScopes/requiredRoles dynamic tool rejects an anonymous caller', async () => {
    await expect(
      client.callTool({ name: 'admin-operation', arguments: {} }),
    ).rejects.toThrow(/authentication/i);
  });

  test('mixed mode: decorator-based static tool works alongside dynamic ones', async () => {
    const res = await client.callTool({ name: 'static-tool', arguments: { input: 'hi' } });
    expect(text(res)).toContain('Static: hi');
  });

  test('dynamic-tool (plain dynamic registration) executes', async () => {
    const res = await client.callTool({ name: 'dynamic-tool', arguments: {} });
    expect(text(res)).toContain('Dynamic result');
  });

  test('tool registered from an external module (ExternalCapabilitiesService) executes', async () => {
    const res = await client.callTool({ name: 'external-tool', arguments: {} });
    expect(text(res)).toContain('result');
  });

  test('resources/list reflects registration and deregistration', async () => {
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(['mcp://app-config']);
  });

  test('reading a dynamic resource returns its JSON content', async () => {
    const res = await client.readResource({ uri: 'mcp://app-config' });
    expect(res.contents).toHaveLength(1);
    const content = res.contents[0] as { uri: string; mimeType: string; text: string };
    expect(content.mimeType).toBe('application/json');
    expect(JSON.parse(content.text)).toEqual({ env: 'production', version: '2.0.0' });
  });

  test('reading a removed-and-never-re-registered resource errors', async () => {
    await expect(client.readResource({ uri: 'mcp://gone-resource' })).rejects.toThrow(
      /gone-resource/i,
    );
  });

  test('prompts/list reflects registration and deregistration', async () => {
    const { prompts } = await client.listPrompts();
    const names = prompts.map((p) => p.name).sort();
    expect(names).toEqual(['greeting', 'summarize']);
  });

  test('dynamic prompt with parameters interpolates args (default style)', async () => {
    const res = await client.getPrompt({
      name: 'summarize',
      arguments: { text: 'Sample text' },
    });
    expect(res.description).toBe('Summarize the provided text');
    expect(res.messages).toEqual([
      {
        role: 'user',
        content: {
          type: 'text',
          text: 'Please summarize in brief style:\n\nSample text',
        },
      },
    ]);
  });

  test('dynamic prompt with parameters honors an explicit optional arg', async () => {
    const res = await client.getPrompt({
      name: 'summarize',
      arguments: { text: 'Sample text', style: 'detailed' },
    });
    expect(res.messages[0]).toEqual({
      role: 'user',
      content: {
        type: 'text',
        text: 'Please summarize in detailed style:\n\nSample text',
      },
    });
  });

  test('dynamic prompt without parameters', async () => {
    const res = await client.getPrompt({ name: 'greeting' });
    expect(res.description).toBe('A simple greeting prompt');
    expect(res.messages).toEqual([
      { role: 'user', content: { type: 'text', text: 'Hello!' } },
    ]);
  });

  test('getting a removed-and-never-re-registered prompt errors', async () => {
    await expect(client.getPrompt({ name: 'gone-prompt' })).rejects.toThrow(/gone-prompt/i);
  });

  test('multi-server isolation: server-a-tool is only visible on /server-a/mcp', async () => {
    // Neither multi-server strategy names a `server` tag, so the unnamed
    // `@McpController` (`static-tool`) binds to all three -- only the
    // *dynamically* registered `server-a-tool` is scoped to a single strategy.
    const [listA, listB, listMain] = await Promise.all([
      clientA.listTools(),
      clientB.listTools(),
      client.listTools(),
    ]);
    expect(listA.tools.map((t) => t.name).sort()).toEqual(['server-a-tool', 'static-tool']);
    expect(listB.tools.map((t) => t.name)).toEqual(['static-tool']);
    expect(listMain.tools.map((t) => t.name)).not.toContain('server-a-tool');
  });

  test('multi-server isolation: server-a-tool is callable on server A only', async () => {
    const res = await clientA.callTool({ name: 'server-a-tool', arguments: {} });
    expect(text(res)).toContain('server-a');

    await expect(clientB.callTool({ name: 'server-a-tool', arguments: {} })).rejects.toThrow();
    await expect(client.callTool({ name: 'server-a-tool', arguments: {} })).rejects.toThrow();
  });
});
