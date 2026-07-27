/**
 * e2e for `examples/server-examples` — verifies the runnable patterns
 * documented in docs/server-examples.md against real, spawned example
 * servers, driven by both a pinned old (1.10.0) and a modern (2026-07-28)
 * client. Each variant boots ONE server and drives it with both.
 *
 * Unlike other examples, `server-examples` has several `src/main-*.ts` entry
 * points (one per transport/config variant) and no single `start` script, so
 * each variant below boots its own server with an explicit `startCommand`
 * and its own free port.
 *
 * Only variants reachable over Streamable HTTP are covered here (STDIO can't
 * be driven by these clients, and OAuth is out of scope per the example's own
 * README).
 *
 * Run:  bun test server-examples.test.ts        (from the e2e/ directory)
 *
 * Green = every HTTP variant serves both eras — including `main-stateful.ts`,
 * where a modern (sessionless) client and a session-managed legacy client share
 * one endpoint. A break names exactly which variant and which era regressed.
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

function text(result: any): string {
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}

describe('examples/server-examples: stateful Streamable HTTP (main-stateful.ts)', () => {
  let server: RunningExample;
  const clients: Partial<Record<Era, EraClient>> = {};

  beforeAll(async () => {
    const port = await getFreePort();
    server = await startExample('server-examples', port, {
      startCommand: 'ts-node-dev --respawn src/main-stateful.ts',
      readyTimeoutMs: BOOT_MS,
    });
    for (const era of ERAS) {
      clients[era] = await createEraClient(era, server.url);
    }
  }, BOOT_MS);

  afterAll(async () => {
    for (const era of ERAS) await clients[era]?.close();
    await server?.stop();
  });

  describe.each(ERAS)('%s era', (era) => {
  const client = () => clients[era]!;

  test('tools/list advertises greet-user', async () => {
    const { tools } = await client().listTools();
    expect(tools.map((t) => t.name)).toEqual(['greet-user']);
  });

  test('greet-user call returns a localized greeting', async () => {
    const res = await client().callTool({
      name: 'greet-user',
      arguments: { name: 'Alice', language: 'fr' },
    });
    expect(text(res)).toContain('Salut, Alice!');
  });

  test('resources/list and resources/read work over the session-managed transport', async () => {
    const { resources } = await client().listResources();
    expect(resources.map((r) => r.uri)).toEqual(['mcp://greeting']);

    const res = await client().readResource({ uri: 'mcp://greeting' });
    const content = res.contents[0] as { text: string };
    expect(content.text).toBe('Hello from mcp-nest!');
  });

  test('prompts/list and prompts/get work over the session-managed transport', async () => {
    const { prompts } = await client().listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['greeting-guide']);

    const res = await client().getPrompt({ name: 'greeting-guide' });
    expect(res.messages[0].content.text).toContain('Always greet users warmly');
  });
  });
});

describe('examples/server-examples: stateless Streamable HTTP (main-stateless.ts)', () => {
  let server: RunningExample;
  const clients: Partial<Record<Era, EraClient>> = {};

  beforeAll(async () => {
    const port = await getFreePort();
    server = await startExample('server-examples', port, {
      startCommand: 'ts-node-dev --respawn src/main-stateless.ts',
      readyTimeoutMs: BOOT_MS,
    });
    for (const era of ERAS) {
      clients[era] = await createEraClient(era, server.url);
    }
  }, BOOT_MS);

  afterAll(async () => {
    for (const era of ERAS) await clients[era]?.close();
    await server?.stop();
  });

  describe.each(ERAS)('%s era', (era) => {
  const client = () => clients[era]!;

  test('tools/list advertises greet-user', async () => {
    const { tools } = await client().listTools();
    expect(tools.map((t) => t.name)).toEqual(['greet-user']);
  });

  test('greet-user call returns a localized greeting without a session', async () => {
    const res = await client().callTool({
      name: 'greet-user',
      arguments: { name: 'Bob', language: 'es' },
    });
    expect(text(res)).toContain('Qué tal, Bob!');
  });

  test('server metadata (title, instructions) survives to initialize', async () => {
    const version = client().getServerVersion() as { name: string; title?: string } | undefined;
    expect(version?.name).toBe('example-mcp-server');
    expect(version?.title).toBe('Example MCP Server');
    expect(client().getInstructions()).toBe(
      'Use greet-user for greetings. Prefer structured tools when available.',
    );
  });

  test('resources and prompts are still reachable in stateless mode', async () => {
    const { resources } = await client().listResources();
    expect(resources.map((r) => r.uri)).toEqual(['mcp://greeting']);

    const { prompts } = await client().listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['greeting-guide']);
  });
  });
});

describe('examples/server-examples: multiple transports (main-multi-transport.ts)', () => {
  let server: RunningExample;
  const clients: Partial<Record<Era, EraClient>> = {};

  beforeAll(async () => {
    const port = await getFreePort();
    server = await startExample('server-examples', port, {
      startCommand: 'ts-node-dev --respawn src/main-multi-transport.ts',
      readyTimeoutMs: BOOT_MS,
    });
    for (const era of ERAS) {
      clients[era] = await createEraClient(era, server.url);
    }
  }, BOOT_MS);

  afterAll(async () => {
    for (const era of ERAS) await clients[era]?.close();
    await server?.stop();
  });

  describe.each(ERAS)('%s era', (era) => {
  const client = () => clients[era]!;

  test('tools/list advertises only greet-user (no resource/prompt controllers registered)', async () => {
    const { tools } = await client().listTools();
    expect(tools.map((t) => t.name)).toEqual(['greet-user']);
  });

  test('greet-user call works over the Streamable HTTP transport', async () => {
    const res = await client().callTool({
      name: 'greet-user',
      arguments: { name: 'Carol', language: 'en' },
    });
    expect(text(res)).toContain('Hey, Carol!');
  });
  });
});

describe('examples/server-examples: custom endpoint (main-custom-endpoint.ts)', () => {
  let server: RunningExample;
  const clients: Partial<Record<Era, EraClient>> = {};

  beforeAll(async () => {
    const port = await getFreePort();
    server = await startExample('server-examples', port, {
      startCommand: 'ts-node-dev --respawn src/main-custom-endpoint.ts',
      endpoint: '/api/v1/mcp-operations',
      readyTimeoutMs: BOOT_MS,
    });
    for (const era of ERAS) {
      clients[era] = await createEraClient(era, server.url);
    }
  }, BOOT_MS);

  afterAll(async () => {
    for (const era of ERAS) await clients[era]?.close();
    await server?.stop();
  });

  describe.each(ERAS)('%s era', (era) => {
  const client = () => clients[era]!;

  test('the server is reachable at the configured custom endpoint', async () => {
    const { tools } = await client().listTools();
    expect(tools.map((t) => t.name)).toEqual(['greet-user']);
  });

  test('greet-user call works at the custom endpoint', async () => {
    const res = await client().callTool({
      name: 'greet-user',
      arguments: { name: 'Dave', language: 'de' },
    });
    // 'de' is not in the tool's greetings map, so it falls back to the default 'en' greeting.
    expect(text(res)).toContain('Hey, Dave!');
  });
  });
});

describe('examples/server-examples: global prefix coexistence (main-global-prefix.ts)', () => {
  let server: RunningExample;
  const clients: Partial<Record<Era, EraClient>> = {};

  beforeAll(async () => {
    const port = await getFreePort();
    server = await startExample('server-examples', port, {
      startCommand: 'ts-node-dev --respawn src/main-global-prefix.ts',
      readyTimeoutMs: BOOT_MS,
    });
    for (const era of ERAS) {
      clients[era] = await createEraClient(era, server.url);
    }
  }, BOOT_MS);

  afterAll(async () => {
    for (const era of ERAS) await clients[era]?.close();
    await server?.stop();
  });

  describe.each(ERAS)('%s era', (era) => {
  const client = () => clients[era]!;

  test('MCP routes stay unprefixed at /mcp despite app.setGlobalPrefix("/api")', async () => {
    const { tools } = await client().listTools();
    expect(tools.map((t) => t.name)).toEqual(['greet-user']);
  });

  test('a normal Nest controller IS affected by the global prefix', async () => {
    const prefixed = await fetch(`http://127.0.0.1:${server.port}/api/ping`);
    expect(prefixed.status).toBe(200);
    expect(await prefixed.json()).toEqual({ ok: true });

    const unprefixed = await fetch(`http://127.0.0.1:${server.port}/ping`);
    expect(unprefixed.status).toBe(404);
  });
  });
});

describe('examples/server-examples: Fastify adapter (main-fastify.ts)', () => {
  let server: RunningExample;
  const clients: Partial<Record<Era, EraClient>> = {};

  beforeAll(async () => {
    const port = await getFreePort();
    server = await startExample('server-examples', port, {
      startCommand: 'ts-node-dev --respawn src/main-fastify.ts',
      readyTimeoutMs: BOOT_MS,
    });
    for (const era of ERAS) {
      clients[era] = await createEraClient(era, server.url);
    }
  }, BOOT_MS);

  afterAll(async () => {
    for (const era of ERAS) await clients[era]?.close();
    await server?.stop();
  });

  describe.each(ERAS)('%s era', (era) => {
  const client = () => clients[era]!;

  test('tools/list works with the Fastify HTTP adapter', async () => {
    const { tools } = await client().listTools();
    expect(tools.map((t) => t.name)).toEqual(['greet-user']);
  });

  test('greet-user call works with the Fastify HTTP adapter', async () => {
    const res = await client().callTool({
      name: 'greet-user',
      arguments: { name: 'Eve', language: 'fr' },
    });
    expect(text(res)).toContain('Salut, Eve!');
  });

  test('resources and prompts also work with the Fastify HTTP adapter', async () => {
    const { resources } = await client().listResources();
    expect(resources.map((r) => r.uri)).toEqual(['mcp://greeting']);

    const { prompts } = await client().listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['greeting-guide']);
  });
  });
});
