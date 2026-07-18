/**
 * e2e for `examples/resources` — verifies the behaviors documented in
 * docs/resources.md against a real, spawned example server, driven by a
 * pinned old MCP client.
 *
 * Run:  bun test resources.test.ts        (from the e2e/ directory)
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

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('resources', port, { readyTimeoutMs: BOOT_MS });
  client = await createLegacyClient(server.url);
}, BOOT_MS);

afterAll(async () => {
  await client?.close?.();
  await server?.stop();
});

describe('examples/resources e2e (pinned @modelcontextprotocol/sdk@1.10.0 client)', () => {
  test('resources/list advertises every documented resource', async () => {
    const { resources } = await client.listResources();
    const byUri = Object.fromEntries(resources.map((r) => [r.uri, r]));

    expect(Object.keys(byUri).sort()).toEqual(
      [
        'mcp://languages/informal-greetings',
        'mcp://config/app',
        'mcp://help/usage',
        'mcp://docs/readme',
      ].sort(),
    );

    expect(byUri['mcp://languages/informal-greetings']).toMatchObject({
      name: 'languages-informal-greetings',
      description: 'Languages and their informal greeting phrases',
      mimeType: 'application/json',
    });
    expect(byUri['mcp://config/app']).toMatchObject({
      name: 'config-data',
      description: 'Application configuration',
      mimeType: 'application/json',
    });
    expect(byUri['mcp://help/usage']).toMatchObject({
      name: 'help-text',
      description: 'Help documentation',
      mimeType: 'text/plain',
    });
    expect(byUri['mcp://docs/readme']).toMatchObject({
      name: 'readme',
      description: 'Project documentation',
      mimeType: 'text/markdown',
    });
  });

  test('reading the languages resource returns the exact JSON documented', async () => {
    const res = await client.readResource({ uri: 'mcp://languages/informal-greetings' });
    expect(res.contents).toHaveLength(1);
    const content = res.contents[0] as { uri: string; mimeType: string; text: string };
    expect(content.uri).toBe('mcp://languages/informal-greetings');
    expect(content.mimeType).toBe('application/json');
    expect(JSON.parse(content.text)).toEqual({
      en: 'Hey',
      es: 'Qué tal',
      fr: 'Salut',
      de: 'Hi',
      it: 'Ciao',
      pt: 'Oi',
      ja: 'やあ',
      ko: '안녕',
      zh: '嗨',
    });
  });

  test('reading the config resource returns JSON content', async () => {
    const res = await client.readResource({ uri: 'mcp://config/app' });
    expect(res.contents).toHaveLength(1);
    const content = res.contents[0] as { uri: string; mimeType: string; text: string };
    expect(content.uri).toBe('mcp://config/app');
    expect(content.mimeType).toBe('application/json');
    expect(JSON.parse(content.text)).toEqual({ version: '1.0', debug: true });
  });

  test('reading the help resource returns plain text content', async () => {
    const res = await client.readResource({ uri: 'mcp://help/usage' });
    expect(res.contents).toHaveLength(1);
    const content = res.contents[0] as { uri: string; mimeType: string; text: string };
    expect(content.uri).toBe('mcp://help/usage');
    expect(content.mimeType).toBe('text/plain');
    expect(content.text).toBe('This is how you use the application...');
  });

  test('reading the readme resource returns markdown content', async () => {
    const res = await client.readResource({ uri: 'mcp://docs/readme' });
    expect(res.contents).toHaveLength(1);
    const content = res.contents[0] as { uri: string; mimeType: string; text: string };
    expect(content.uri).toBe('mcp://docs/readme');
    expect(content.mimeType).toBe('text/markdown');
    expect(content.text).toBe('# My Project\n\nThis project does amazing things...');
  });

  test('resource templates/list is empty (no templated resources in this example)', async () => {
    const res: any = await client.request(
      { method: 'resources/templates/list', params: {} },
      WireResult,
    );
    expect(res.resourceTemplates ?? []).toEqual([]);
  });

  test('reading an unknown resource URI surfaces a protocol error', async () => {
    await expect(client.readResource({ uri: 'mcp://does-not-exist' })).rejects.toThrow();
  });
});
