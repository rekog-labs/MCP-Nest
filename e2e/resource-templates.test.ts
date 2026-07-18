/**
 * e2e for `examples/resource-templates` — verifies the behaviors documented in
 * docs/resource-templates.md against a real, spawned example server, driven by
 * a pinned old MCP client.
 *
 * Run:  bun test resource-templates.test.ts        (from the e2e/ directory)
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

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('resource-templates', port, { readyTimeoutMs: BOOT_MS });
  client = await createLegacyClient(server.url);
}, BOOT_MS);

afterAll(async () => {
  await client?.close?.();
  await server?.stop();
});

describe('examples/resource-templates e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('resources/templates/list advertises every documented template', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const byName = Object.fromEntries(resourceTemplates.map((t) => [t.name, t]));

    expect(Object.keys(byName).sort()).toEqual(
      [
        'user-language',
        'account-single-param',
        'account-multi-param',
        'docs-wildcard-param',
      ].sort(),
    );

    expect(byName['user-language']).toMatchObject({
      description: "Get a specific user's preferred language",
      mimeType: 'application/json',
      uriTemplate: 'mcp://users/{name}',
    });
    expect(byName['account-single-param']).toMatchObject({
      description: 'Single parameter URI template',
      mimeType: 'application/json',
      uriTemplate: 'mcp://accounts/{userId}',
    });
    expect(byName['account-multi-param']).toMatchObject({
      description: 'Multiple parameters URI template',
      mimeType: 'application/json',
      uriTemplate: 'mcp://accounts/{userId}/posts/{postId}',
    });
    expect(byName['docs-wildcard-param']).toMatchObject({
      description: 'Wildcard (catch-all) URI template',
      mimeType: 'application/json',
      uriTemplate: 'mcp://docs/{path*}',
    });
  });

  test('user-language template resolves a known user (carlos -> es)', async () => {
    const res = await client.readResource({ uri: 'mcp://users/carlos' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://users/carlos',
        mimeType: 'application/json',
        text: JSON.stringify({ name: 'carlos', language: 'es' }, null, 2),
      },
    ]);
  });

  test('user-language template resolves a different known user (yuki -> ja)', async () => {
    const res = await client.readResource({ uri: 'mcp://users/yuki' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://users/yuki',
        mimeType: 'application/json',
        text: JSON.stringify({ name: 'yuki', language: 'ja' }, null, 2),
      },
    ]);
  });

  test('user-language template falls back to english for unknown users', async () => {
    const res = await client.readResource({ uri: 'mcp://users/unknown' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://users/unknown',
        mimeType: 'application/json',
        text: JSON.stringify({ name: 'unknown', language: 'en' }, null, 2),
      },
    ]);
  });

  test('single-parameter template extracts one path segment', async () => {
    const res = await client.readResource({ uri: 'mcp://accounts/123' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://accounts/123',
        mimeType: 'application/json',
        text: JSON.stringify({ userId: '123' }),
      },
    ]);
  });

  test('multi-parameter template extracts every path segment', async () => {
    const res = await client.readResource({ uri: 'mcp://accounts/123/posts/456' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://accounts/123/posts/456',
        mimeType: 'application/json',
        text: JSON.stringify({ userId: '123', postId: '456' }),
      },
    ]);
  });

  test('wildcard template captures a multi-segment catch-all path', async () => {
    const res = await client.readResource({ uri: 'mcp://docs/docs/readme.md' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://docs/docs/readme.md',
        mimeType: 'application/json',
        text: JSON.stringify({ path: 'docs/readme.md' }),
      },
    ]);
  });

  test('wildcard template also matches a single path segment', async () => {
    const res = await client.readResource({ uri: 'mcp://docs/readme' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://docs/readme',
        mimeType: 'application/json',
        text: JSON.stringify({ path: 'readme' }),
      },
    ]);
  });

  test('wildcard template is not optional: the bare parent URI does not resolve', async () => {
    await expect(client.readResource({ uri: 'mcp://docs' })).rejects.toThrow();
  });

  test('reading a URI that matches no template surfaces a protocol error', async () => {
    await expect(client.readResource({ uri: 'mcp://nonexistent/thing' })).rejects.toThrow();
  });
});
