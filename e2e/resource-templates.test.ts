/**
 * e2e for `examples/resource-templates` — verifies the behaviors documented in
 * docs/resource-templates.md against a real, spawned example server, driven by
 * driven by both a pinned old (1.10.0) and a modern (2026-07-28) client.
 *
 * Run:  bun test resource-templates.test.ts        (from the e2e/ directory)
 *
 * Green = a dual-era server serves both: old clients in the wild keep working,
 * and the 2026 leg does too. A break names exactly which era regressed.
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

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('resource-templates', port, { readyTimeoutMs: BOOT_MS });
  // One server, both eras: also the dual-era concurrency proof.
  for (const era of ERAS) {
    clients[era] = await createEraClient(era, server.url);
  }
}, BOOT_MS);

afterAll(async () => {
  for (const era of ERAS) await clients[era]?.close();
  await server?.stop();
});

describe.each(ERAS)('examples/resource-templates e2e (%s era)', (era) => {
  const client = () => clients[era]!;
  test('resources/templates/list advertises every documented template', async () => {
    const { resourceTemplates } = await client().listResourceTemplates();
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
    const res = await client().readResource({ uri: 'mcp://users/carlos' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://users/carlos',
        mimeType: 'application/json',
        text: JSON.stringify({ name: 'carlos', language: 'es' }, null, 2),
      },
    ]);
  });

  test('user-language template resolves a different known user (yuki -> ja)', async () => {
    const res = await client().readResource({ uri: 'mcp://users/yuki' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://users/yuki',
        mimeType: 'application/json',
        text: JSON.stringify({ name: 'yuki', language: 'ja' }, null, 2),
      },
    ]);
  });

  test('user-language template falls back to english for unknown users', async () => {
    const res = await client().readResource({ uri: 'mcp://users/unknown' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://users/unknown',
        mimeType: 'application/json',
        text: JSON.stringify({ name: 'unknown', language: 'en' }, null, 2),
      },
    ]);
  });

  test('single-parameter template extracts one path segment', async () => {
    const res = await client().readResource({ uri: 'mcp://accounts/123' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://accounts/123',
        mimeType: 'application/json',
        text: JSON.stringify({ userId: '123' }),
      },
    ]);
  });

  test('multi-parameter template extracts every path segment', async () => {
    const res = await client().readResource({ uri: 'mcp://accounts/123/posts/456' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://accounts/123/posts/456',
        mimeType: 'application/json',
        text: JSON.stringify({ userId: '123', postId: '456' }),
      },
    ]);
  });

  test('wildcard template captures a multi-segment catch-all path', async () => {
    const res = await client().readResource({ uri: 'mcp://docs/docs/readme.md' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://docs/docs/readme.md',
        mimeType: 'application/json',
        text: JSON.stringify({ path: 'docs/readme.md' }),
      },
    ]);
  });

  test('wildcard template also matches a single path segment', async () => {
    const res = await client().readResource({ uri: 'mcp://docs/readme' });
    expect(res.contents).toEqual([
      {
        uri: 'mcp://docs/readme',
        mimeType: 'application/json',
        text: JSON.stringify({ path: 'readme' }),
      },
    ]);
  });

  test('wildcard template is not optional: the bare parent URI does not resolve', async () => {
    await expect(client().readResource({ uri: 'mcp://docs' })).rejects.toThrow();
  });

  test('reading a URI that matches no template surfaces a protocol error', async () => {
    await expect(client().readResource({ uri: 'mcp://nonexistent/thing' })).rejects.toThrow();
  });
});
