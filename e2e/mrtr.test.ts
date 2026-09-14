/**
 * e2e for `examples/mrtr` — Multi Round-Trip Requests (docs/mrtr.md) against a
 * real, spawned example server.
 *
 * Run:  bun test mrtr        (from the e2e/ directory)
 *
 * Both eras drive ONE server process:
 *  - modern (2026-07-28): the v2 client fulfils the embedded requests and
 *    retries, both in auto mode and by hand (which proves the wire shape);
 *  - legacy (pinned 1.10.0): this client predates elicitation, so it represents
 *    an old client in the wild — the server must fail its call cleanly (an
 *    `isError` result, not a hang or a crash) and keep serving everything else.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import {
  createEraClient,
  ERAS,
  getFreePort,
  MODERN_PROTOCOL_VERSION,
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

beforeAll(async () => {
  const port = await getFreePort();
  server = await startExample('mrtr', port, { readyTimeoutMs: BOOT_MS });
  for (const era of ERAS) {
    clients[era] = await createEraClient(era, server.url);
  }
}, BOOT_MS);

afterAll(async () => {
  for (const era of ERAS) await clients[era]?.close();
  await server?.stop();
});

describe.each(ERAS)('examples/mrtr e2e (%s era)', (era) => {
  const client = () => clients[era]!;

  test('advertises the MRTR tools, resource and prompt', async () => {
    const { tools } = await client().listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['capital', 'deploy', 'list-roots']);
    const { resources } = await client().listResources();
    expect(resources.map((r) => r.uri)).toEqual(['mcp://vault']);
    const { prompts } = await client().listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(['interview']);
  });

  test('a client WITHOUT the elicitation capability gets a clean failure, not a hang', async () => {
    // The SDK refuses to ask for an undeclared capability (-32021). On the
    // legacy leg the shim reports it as an `isError` tool result; on 2026-07-28
    // it is a JSON-RPC error, which the v2 client raises.
    const call = client().callTool({ name: 'deploy', arguments: { env: 'prod' } });
    if (era === 'legacy') {
      const result = await call;
      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Cannot request input 'confirm'");
    } else {
      await expect(call).rejects.toMatchObject({
        code: -32021,
        message: expect.stringContaining("Cannot request input 'confirm'"),
      });
    }
  });
});

describe('examples/mrtr e2e (modern era, interactive)', () => {
  async function interactive(answers: Record<string, unknown>) {
    const { Client, StreamableHTTPClientTransport } = await import('@modelcontextprotocol/client');
    const client = new Client(
      { name: 'mrtr-e2e', version: '1.0.0' },
      {
        capabilities: { elicitation: {}, sampling: {}, roots: {} },
        versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
      },
    );
    client.setRequestHandler('elicitation/create', (req: any) => {
      const key = Object.keys(req.params.requestedSchema.properties)[0];
      return key in answers
        ? { action: 'accept', content: { [key]: answers[key] } }
        : { action: 'decline' };
    });
    client.setRequestHandler('sampling/createMessage', () => ({
      role: 'assistant',
      content: { type: 'text', text: 'Paris' },
      model: 'e2e',
    }));
    client.setRequestHandler('roots/list', () => ({
      roots: [{ uri: 'file:///w', name: 'w' }],
    }));
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
    return client;
  }

  test('deploy: two elicitation rounds, state carried in requestState', async () => {
    const client = await interactive({ confirm: true, reason: 'release 1.2' });
    try {
      const result: any = await client.callTool({ name: 'deploy', arguments: { env: 'prod' } });
      expect(text(result)).toBe('deployed to prod — reason: release 1.2');
    } finally {
      await client.close();
    }
  });

  test('deploy: a declined reason aborts instead of erroring', async () => {
    const client = await interactive({ confirm: true });
    try {
      const result: any = await client.callTool({ name: 'deploy', arguments: { env: 'qa' } });
      expect(text(result)).toBe('deployment to qa aborted');
    } finally {
      await client.close();
    }
  });

  test('sampling, roots, resource and prompt all round-trip', async () => {
    const client = await interactive({ passphrase: 'open sesame', topic: 'MCP' });
    try {
      expect(text(await client.callTool({ name: 'capital', arguments: { country: 'France' } }))).toContain('Paris');
      expect(text(await client.callTool({ name: 'list-roots', arguments: {} }))).toContain('file:///w');
      const res: any = await client.readResource({ uri: 'mcp://vault' });
      expect(res.contents[0].text).toContain('treasure');
      const prompt: any = await client.getPrompt({ name: 'interview' });
      expect(prompt.messages[0].content.text).toContain('MCP');
    } finally {
      await client.close();
    }
  });

  test('manual retry loop: the wire carries input_required, inputResponses and requestState', async () => {
    const { Client, StreamableHTTPClientTransport, isInputRequiredResult } = await import('@modelcontextprotocol/client');
    const client = new Client(
      { name: 'mrtr-e2e-manual', version: '1.0.0' },
      {
        capabilities: { elicitation: {} },
        versionNegotiation: { mode: { pin: MODERN_PROTOCOL_VERSION } },
        inputRequired: { autoFulfill: false },
      },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
    try {
      const answers: Record<string, unknown> = { confirm: true, reason: 'by hand' };
      let inputResponses: Record<string, unknown> | undefined;
      let requestState: string | undefined;
      const seenKeys: string[] = [];
      let final: any;
      for (let round = 0; round < 5; round++) {
        const value: any = await client.request(
          {
            method: 'tools/call',
            params: {
              name: 'deploy',
              arguments: { env: 'prod' },
              ...(inputResponses && { inputResponses }),
              ...(requestState && { requestState }),
            },
          },
          { allowInputRequired: true },
        );
        if (!isInputRequiredResult(value)) {
          final = value;
          break;
        }
        expect(value.resultType).toBe('input_required');
        expect(typeof value.requestState).toBe('string');
        inputResponses = {};
        for (const key of Object.keys(value.inputRequests ?? {})) {
          seenKeys.push(key);
          inputResponses[key] = { action: 'accept', content: { [key]: answers[key] } };
        }
        requestState = value.requestState;
      }
      expect(seenKeys).toEqual(['confirm', 'reason']);
      expect(text(final)).toBe('deployed to prod — reason: by hand');
    } finally {
      await client.close();
    }
  });
});
