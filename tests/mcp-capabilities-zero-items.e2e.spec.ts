import { join } from 'path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { INestApplication, Logger } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { McpController, McpStrategy, Prompt, Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import {
  bootstrapMcpApp,
  createEraClient,
  Era,
  ERAS,
  MODERN_PROTOCOL_VERSION,
} from './utils';

/**
 * Capability advertisement must not depend on how many tools/resources/prompts
 * exist when the SDK server is created.
 *
 * Any strategy can gain or lose entries at runtime (`registerTool()` &
 * co.), while a server's capability set is fixed when it is created — at
 * `initialize` for a 2025-era session, per request on 2026-07-28. Deriving it
 * from the count broke two things:
 *  - a server that started empty (e.g. a gateway that registers tools once it
 *    has discovered its upstreams) never advertised `tools`, so its clients
 *    never saw tools registered later;
 *  - on the modern era, `tools/list` after the last tool was removed answered
 *    `-32601 Method not found` instead of an empty list.
 */

const text = (res: any): string => res.content?.[0]?.text ?? '';

/**
 * One JSON-RPC request on the wire, bypassing the SDK client — which skips a
 * list request when the server did not advertise the capability, and so would
 * hide what the server itself answers.
 */
async function rawCall(
  era: Era,
  port: number,
  method: string,
): Promise<{ status: number; json: any }> {
  const post = async (body: unknown, headers: Record<string, string>) => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    // The legacy leg answers over SSE unless `enableJsonResponse` is set.
    const data = raw.startsWith('{')
      ? raw
      : raw
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice('data:'.length);
    return {
      status: res.status,
      json: data ? JSON.parse(data) : undefined,
      sessionId: res.headers.get('mcp-session-id') ?? undefined,
    };
  };

  if (era === 'modern') {
    const { status, json } = await post(
      {
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      { 'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION, 'Mcp-Method': method },
    );
    return { status, json };
  }

  const legacyVersion = '2025-06-18';
  const init = await post(
    {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: legacyVersion,
        capabilities: {},
        clientInfo: { name: 'raw', version: '1' },
      },
    },
    {},
  );
  const headers = {
    'mcp-session-id': init.sessionId!,
    'MCP-Protocol-Version': legacyVersion,
  };
  await post(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    headers,
  );
  const { status, json } = await post(
    { jsonrpc: '2.0', id: 1, method, params: {} },
    headers,
  );
  return { status, json };
}

describe.each(ERAS)(
  'E2E: capabilities with zero items (%s era)',
  (era) => {
    let app: INestApplication;
    let port: number;
    let strategy: McpStrategy;

    beforeAll(async () => {
      // Nothing registered at startup: no controllers, no dynamic entries.
      const boot = await bootstrapMcpApp({ controllers: [] });
      app = boot.app;
      port = boot.port;
      strategy = boot.strategy;
    });

    afterAll(async () => {
      await app.close();
    });

    it('advertises tools, resources and prompts with nothing registered', async () => {
      const client = await createEraClient(era, port);
      try {
        const caps = client.getServerCapabilities();
        expect(caps?.tools).toEqual({ listChanged: true });
        expect(caps?.resources).toEqual({ listChanged: true });
        expect(caps?.prompts).toEqual({ listChanged: true });
        expect(caps?.logging).toEqual({});
      } finally {
        await client.close();
      }
    });

    it('lists [] for every kind instead of erroring', async () => {
      const client = await createEraClient(era, port);
      try {
        expect((await client.listTools()).tools).toEqual([]);
        expect((await client.listResources()).resources).toEqual([]);
        expect(
          (await client.listResourceTemplates()).resourceTemplates,
        ).toEqual([]);
        expect((await client.listPrompts()).prompts).toEqual([]);
      } finally {
        await client.close();
      }
    });

    it('answers every list method with an empty result on the wire', async () => {
      const cases: Array<[string, string]> = [
        ['tools/list', 'tools'],
        ['resources/list', 'resources'],
        ['resources/templates/list', 'resourceTemplates'],
        ['prompts/list', 'prompts'],
      ];
      for (const [method, key] of cases) {
        const { status, json } = await rawCall(era, port, method);
        expect({ method, status, error: json?.error }).toEqual({
          method,
          status: 200,
          error: undefined,
        });
        expect(json.result[key]).toEqual([]);
      }
    });

    it('a client connected while empty sees a tool registered later, and [] once it is removed', async () => {
      const client = await createEraClient(era, port);
      try {
        expect((await client.listTools()).tools).toEqual([]);

        strategy.registerTool({
          name: 'late-tool',
          description: 'Registered after the client connected',
          handler: async () => ({
            content: [{ type: 'text', text: 'late result' }],
          }),
        });
        try {
          const { tools } = await client.listTools();
          expect(tools.map((t) => t.name)).toEqual(['late-tool']);
          const res = await client.callTool({
            name: 'late-tool',
            arguments: {},
          });
          expect(text(res)).toBe('late result');
        } finally {
          strategy.removeTool('late-tool');
        }

        // Removing the last tool must leave an empty list, not -32601.
        expect((await client.listTools()).tools).toEqual([]);
        // ...and calling it is an unknown-tool error, not "method not found".
        const err: any = await client
          .callTool({ name: 'late-tool', arguments: {} })
          .then(
            () => undefined,
            (e) => e,
          );
        expect(err).toBeDefined();
        expect(err.code).toBe(-32602);
      } finally {
        await client.close();
      }
    });

    it('a client connected while a tool exists gets [] after the last one is removed', async () => {
      strategy.registerTool({
        name: 'only-tool',
        description: 'The only tool',
        handler: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      });
      const client = await createEraClient(era, port);
      try {
        expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
          'only-tool',
        ]);
        strategy.removeTool('only-tool');
        expect((await client.listTools()).tools).toEqual([]);
      } finally {
        strategy.removeTool('only-tool');
        await client.close();
      }
    });

    it('a client connected while empty sees a resource registered later, and [] once it is removed', async () => {
      const client = await createEraClient(era, port);
      try {
        expect((await client.listResources()).resources).toEqual([]);

        strategy.registerResource({
          uri: 'mcp://late-resource',
          name: 'late-resource',
          mimeType: 'text/plain',
          handler: async () => ({
            contents: [
              {
                uri: 'mcp://late-resource',
                mimeType: 'text/plain',
                text: 'late content',
              },
            ],
          }),
        });
        try {
          const { resources } = await client.listResources();
          expect(resources.map((r) => r.uri)).toEqual(['mcp://late-resource']);
          const read: any = await client.readResource({
            uri: 'mcp://late-resource',
          });
          expect(read.contents[0].text).toBe('late content');
        } finally {
          strategy.removeResource('mcp://late-resource');
        }

        expect((await client.listResources()).resources).toEqual([]);
        expect(
          (await client.listResourceTemplates()).resourceTemplates,
        ).toEqual([]);
      } finally {
        await client.close();
      }
    });

    it('a client connected while empty sees a prompt registered later, and [] once it is removed', async () => {
      const client = await createEraClient(era, port);
      try {
        expect((await client.listPrompts()).prompts).toEqual([]);

        strategy.registerPrompt({
          name: 'late-prompt',
          description: 'Registered after the client connected',
          handler: async () => ({
            messages: [
              {
                role: 'user',
                content: { type: 'text', text: 'late prompt' },
              },
            ],
          }),
        });
        try {
          const { prompts } = await client.listPrompts();
          expect(prompts.map((p) => p.name)).toEqual(['late-prompt']);
          const got: any = await client.getPrompt({ name: 'late-prompt' });
          expect(got.messages[0].content.text).toBe('late prompt');
        } finally {
          strategy.removePrompt('late-prompt');
        }

        expect((await client.listPrompts()).prompts).toEqual([]);
      } finally {
        await client.close();
      }
    });
  },
);

// ============================================================================
// Opting out: `capabilities: { <kind>: undefined }` still removes a capability
// ============================================================================

@McpController()
class OptOutCapabilities {
  @Tool({
    name: 'kept-tool',
    description: 'Tools stay advertised',
    parameters: z.object({}),
  })
  keptTool() {
    return { content: [{ type: 'text', text: 'kept' }] };
  }

  @Prompt({ name: 'dropped-prompt', description: 'Prompts are opted out' })
  droppedPrompt(@Payload() _args: unknown) {
    return {
      messages: [
        { role: 'user', content: { type: 'text', text: 'never served' } },
      ],
    };
  }
}

describe.each(ERAS)('E2E: opting out of a capability (%s era)', (era) => {
  let app: INestApplication;
  let port: number;
  let strategy: McpStrategy;
  let warnSpy: jest.SpyInstance;

  beforeAll(async () => {
    // Spy BEFORE bootstrap — the warning fires during startAllMicroservices().
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const boot = await bootstrapMcpApp({
      controllers: [OptOutCapabilities],
      // Explicitly present-but-undefined opts out, like `logging`.
      capabilities: { prompts: undefined, resources: undefined },
    });
    app = boot.app;
    port = boot.port;
    strategy = boot.strategy;
  });

  afterAll(async () => {
    await app.close();
    warnSpy.mockRestore();
  });

  it('warns at startup that opted-out decorated entries will not be served', () => {
    const messages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(
      messages.filter((m) => m.includes("opts out of the 'prompts' capability")),
    ).toHaveLength(1);
    // No decorated resources, so nothing to warn about for that opt-out.
    expect(
      messages.some((m) => m.includes("opts out of the 'resources'")),
    ).toBe(false);
  });

  it('does not advertise an opted-out capability, and keeps the others', async () => {
    const client = await createEraClient(era, port);
    try {
      const caps = client.getServerCapabilities();
      expect(caps).not.toHaveProperty('prompts');
      expect(caps).not.toHaveProperty('resources');
      expect(caps?.tools).toEqual({ listChanged: true });
      expect((await client.listTools()).tools.map((t) => t.name)).toEqual([
        'kept-tool',
      ]);
    } finally {
      await client.close();
    }
  });

  it('does not serve an opted-out kind, even with entries registered', async () => {
    strategy.registerPrompt({
      name: 'dynamic-prompt',
      description: 'Registered on an opted-out kind',
      handler: async () => ({ messages: [] }),
    });
    try {
      const { json } = await rawCall(era, port, 'prompts/list');
      expect(json.error?.code).toBe(-32601);
      expect(json.result).toBeUndefined();
    } finally {
      strategy.removePrompt('dynamic-prompt');
    }
  });
});

// ============================================================================
// STDIO: one SDK server per connection, so capabilities and handlers are fixed
// for the connection's whole lifetime — the case where a count-based
// capability set could never recover.
// ============================================================================

const STDIO_SERVER = join(
  __dirname,
  'fixtures',
  'stdio-late-registration-server.ts',
);

describe.each(ERAS)(
  'E2E: stdio capabilities with zero items (%s era)',
  (era) => {
    it('serves resources and prompts registered after the connection opened', async () => {
      const isBun = !!process.versions.bun;
      const client = new Client(
        { name: 'stdio-zero-items', version: '1.0.0' },
        era === 'modern'
          ? {
              versionNegotiation: {
                mode: { pin: MODERN_PROTOCOL_VERSION },
              } as const,
            }
          : {},
      );
      await client.connect(
        new StdioClientTransport({
          command: isBun ? 'bun' : 'ts-node-dev',
          args: isBun ? ['run', STDIO_SERVER] : ['--respawn', STDIO_SERVER],
        }),
      );
      try {
        const caps = client.getServerCapabilities();
        expect(caps?.resources).toEqual({ listChanged: true });
        expect(caps?.prompts).toEqual({ listChanged: true });
        expect((await client.listResources()).resources).toEqual([]);
        expect((await client.listPrompts()).prompts).toEqual([]);

        await client.callTool({
          name: 'toggle-late-entries',
          arguments: { present: true },
        });
        expect(
          (await client.listResources()).resources.map((r) => r.uri),
        ).toEqual(['mcp://late-resource']);
        expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(
          ['late-prompt'],
        );
        const read: any = await client.readResource({
          uri: 'mcp://late-resource',
        });
        expect(read.contents[0].text).toBe('late content');

        await client.callTool({
          name: 'toggle-late-entries',
          arguments: { present: false },
        });
        expect((await client.listResources()).resources).toEqual([]);
        expect((await client.listPrompts()).prompts).toEqual([]);
      } finally {
        await client.close();
      }
    }, 30000);
  },
);
