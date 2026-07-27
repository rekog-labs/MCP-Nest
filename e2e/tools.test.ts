/**
 * e2e for `examples/tools` — verifies the behaviors documented in docs/tools.md
 * against a real, spawned example server.
 *
 * Run:  bun test tools        (from the e2e/ directory)
 *
 * Runs the SAME assertions on both protocol eras against ONE server process:
 * the pinned old (1.10.0) client and a modern (2026-07-28) client. Green means
 * a dual-era server genuinely serves both — old clients in the wild keep
 * working, and the 2026 leg does too. A break names exactly which era regressed.
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

// NOTE: mcp-nest currently JSON-stringifies a plain-string tool return, so the
// text content of those tools arrives quoted (`"\"Salut, Alice!\""`). We assert
// on the substantive content (toContain) rather than the exact serialized form,
// so these stay about behavior, not serialization trivia. The protocol-level
// checks below (list/structured/errors) use exact assertions.

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('tools', port, { readyTimeoutMs: BOOT_MS });
  // One server, both clients: this is also the dual-era concurrency proof.
  for (const era of ERAS) {
    clients[era] = await createEraClient(era, server.url);
  }
}, BOOT_MS);

afterAll(async () => {
  for (const era of ERAS) await clients[era]?.close();
  await server?.stop();
});

describe.each(ERAS)('examples/tools e2e (%s era)', (era) => {
  const client = () => clients[era]!;
  test('tools/list advertises every documented tool', async () => {
    const { tools } = await client().listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'admin-action',
        'arktype-add',
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
    const { tools } = await client().listTools();
    const meta = tools.find((t) => t.name === 'greet-user-meta')?._meta;
    expect(meta?.['example.com/category']).toBe('greeting');
    expect(meta?.['example.com/version']).toBe(2);
  });

  test('basic tool call returns a localized greeting', async () => {
    const res = await client().callTool({
      name: 'greet-user',
      arguments: { name: 'Alice', language: 'fr' },
    });
    expect(text(res)).toContain('Salut, Alice!');
  });

  test('output schema -> structuredContent on the wire', async () => {
    const res: any = await client().callToolWire({
      name: 'greet-user-structured',
      arguments: { name: 'Charlie', language: 'fr' },
    });
    expect(res.structuredContent).toBeDefined();
    expect(res.structuredContent.languageName).toBe('English');
    expect(res.structuredContent.language).toBe('fr');
  });

  test('progress notifications reach the client', async () => {
    const progress: number[] = [];
    const res = await client().callTool(
      { name: 'process-data', arguments: { data: 'payload' } },
      { onprogress: (p: any) => progress.push(p.progress) },
    );
    expect(text(res)).toContain('Processed: payload');
    expect(progress.length).toBeGreaterThan(0);
  });

  test('@McpRawRequest() exposes transport request headers', async () => {
    const res = await client().callTool({ name: 'whoami', arguments: {} });
    expect(text(res)).toContain('user-agent:');
  });

  test('ctx.mcpRequest reflects the JSON-RPC method', async () => {
    const res = await client().callTool({ name: 'inspect-request', arguments: { input: 'hi' } });
    expect(text(res)).toContain('method=tools/call');
  });

  test('_meta-carrying tool still executes normally', async () => {
    const res = await client().callTool({ name: 'greet-user-meta', arguments: { name: 'Bob' } });
    expect(text(res)).toContain('Hey, Bob!');
  });

  test('tool guard denial surfaces as isError (no user on request)', async () => {
    const res: any = await client().callTool({ name: 'admin-action', arguments: { target: 'server' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('Forbidden');
  });

  test('method-level @UseFilters maps a custom error', async () => {
    const res: any = await client().callTool({ name: 'boom', arguments: {} });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('[BOOM] kaboom');
  });

  test('plain Error is masked, RpcException is surfaced', async () => {
    const plain: any = await client().callTool({ name: 'throw-plain', arguments: {} });
    expect(plain.isError).toBe(true);
    expect(text(plain)).not.toContain('super secret internal detail');

    const rpc: any = await client().callTool({ name: 'throw-rpc', arguments: {} });
    expect(rpc.isError).toBe(true);
    expect(text(rpc)).toContain('actionable client-facing message');
  });

  test('filters on a resource surface a protocol error', async () => {
    await expect(client().readResource({ uri: 'mcp://my-resource' })).rejects.toThrow();
  });

  test('filters on a prompt surface a protocol error', async () => {
    await expect(client().getPrompt({ name: 'my-prompt' })).rejects.toThrow();
  });

  // Proves a NON-Zod Standard Schema validator (ArkType 2.x) drives a tool
  // end-to-end: ArkType's ~standard.jsonSchema reaches tools/list, and its
  // ~standard.validate runs server-side on tools/call.
  describe('ArkType (non-Zod Standard Schema) tool', () => {
    test('inputSchema emission (ArkType -> JSON Schema on the wire)', async () => {
      const { tools } = await client().listTools();
      const t: any = tools.find((x) => x.name === 'arktype-add');
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema.properties.a).toBeDefined();
      expect(t.inputSchema.properties.b).toBeDefined();
    });

    test('valid call -> ArkType-validated structuredContent', async () => {
      const res: any = await client().callToolWire({
        name: 'arktype-add',
        arguments: { a: 2, b: 3 },
      });
      expect(res.structuredContent.sum).toBe(5);
    });

    test('invalid call -> ArkType validation rejects server-side', async () => {
      const res: any = await client().callTool({ name: 'arktype-add', arguments: { a: 'nope', b: 3 } });
      expect(res.isError).toBe(true);
      expect(text(res)).toContain('Invalid parameters');
    });
  });
});
