/**
 * Protocol revision `2026-07-28` ("modern era") coverage.
 *
 * These tests drive the SAME server the legacy suites drive. Nothing here edits
 * an existing spec — the existing suites passing unchanged is the backward
 * compatibility proof; this file is the forward proof.
 */
import { Controller, Injectable } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  McpController,
  Prompt,
  Resource,
  ResourceTemplate,
  Tool,
} from '@rekog/mcp-nest';
import type { Context } from '@rekog/mcp-nest';
import { bootstrapMcpApp, StreamableHttpTransport } from './utils';

const MODERN = '2026-07-28';

@Injectable()
@Controller()
@McpController()
class ModernCapabilities {
  @Tool({
    name: 'greet',
    description: 'Greets someone',
    parameters: z.object({ name: z.string() }),
  })
  greet(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  }

  @Tool({
    name: 'work',
    description: 'Reports progress then finishes',
    parameters: z.object({}),
  })
  async work(@Payload() _args: unknown, @Ctx() context: Context) {
    await context.reportProgress({ progress: 1, total: 2 });
    await context.reportProgress({ progress: 2, total: 2 });
    return { content: [{ type: 'text', text: 'done' }] };
  }

  @Tool({
    name: 'talk',
    description: 'Emits a server log line',
    parameters: z.object({}),
  })
  talk(@Payload() _args: unknown, @Ctx() context: Context) {
    context.log.info('hello from the tool');
    return { content: [{ type: 'text', text: 'logged' }] };
  }

  @Tool({
    name: 'whoami',
    description: 'Echoes the per-request client identity',
    parameters: z.object({}),
  })
  whoami(@Payload() _args: unknown, @Ctx() context: Context) {
    const ctx = context as any;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            era: ctx.getSession().era,
            sessionId: ctx.getSession().sessionId ?? null,
            protocolVersion: ctx.getProtocolVersion() ?? null,
            clientName: ctx.getClientInfo()?.name ?? null,
          }),
        },
      ],
    };
  }

  @Resource({
    uri: 'mcp://config',
    name: 'config',
    description: 'Static config',
    mimeType: 'application/json',
  })
  config() {
    return {
      contents: [
        {
          uri: 'mcp://config',
          mimeType: 'application/json',
          text: '{"ok":true}',
        },
      ],
    };
  }

  @ResourceTemplate({
    uriTemplate: 'mcp://users/{id}',
    name: 'user',
    description: 'A user',
    mimeType: 'application/json',
  })
  user(@Payload() { id }: { id: string }) {
    return {
      contents: [
        {
          uri: `mcp://users/${id}`,
          mimeType: 'application/json',
          text: `{"id":"${id}"}`,
        },
      ],
    };
  }

  @Prompt({
    name: 'intro',
    description: 'An intro prompt',
    parameters: z.object({ topic: z.string() }),
  })
  intro(@Payload() { topic }: { topic: string }) {
    return {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: `Tell me about ${topic}` },
        },
      ],
    };
  }
}

let app: any;
let port: number;
let strategy: any;
/** A sessionless deployment — GET/DELETE have no legacy session role to play. */
let statelessApp: any;
let statelessPort: number;

beforeAll(async () => {
  const boot = await bootstrapMcpApp({
    controllers: [ModernCapabilities],
    // Default posture is dual-era: this one endpoint answers both revisions.
    transports: [new StreamableHttpTransport({ statefulMode: true })],
  });
  app = boot.app;
  port = boot.port;
  strategy = boot.strategy;

  const statelessBoot = await bootstrapMcpApp({
    controllers: [ModernCapabilities],
    transports: [new StreamableHttpTransport({ statefulMode: false })],
  });
  statelessApp = statelessBoot.app;
  statelessPort = statelessBoot.port;
});

afterAll(async () => {
  await app?.close();
  await statelessApp?.close();
});

/** A client pinned to the modern revision — no probe, no legacy fallback. */
async function createModernClient(): Promise<Client> {
  const client = new Client(
    { name: 'modern-test-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: MODERN } } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)),
  );
  return client;
}

/** Raw POST helper for the wire-level checks the client SDK papers over. */
async function rawPost(
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

const envelope = {
  'io.modelcontextprotocol/protocolVersion': MODERN,
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/clientInfo': { name: 'raw', version: '1' },
};

describe('modern era — capabilities', () => {
  it('serves tools/list and tools/call', async () => {
    const client = await createModernClient();
    const tools = await client.listTools();
    expect(tools.tools.map((t: any) => t.name).sort()).toEqual([
      'greet',
      'talk',
      'whoami',
      'work',
    ]);

    const result: any = await client.callTool({
      name: 'greet',
      arguments: { name: 'rinor' },
    });
    expect(result.content[0].text).toBe('Hello, rinor!');
    await client.close();
  });

  it('serves resources, resource templates and prompts', async () => {
    const client = await createModernClient();

    const resources = await client.listResources();
    expect(resources.resources.map((r: any) => r.uri)).toContain(
      'mcp://config',
    );

    const read: any = await client.readResource({ uri: 'mcp://config' });
    expect(read.contents[0].text).toBe('{"ok":true}');

    const templates = await client.listResourceTemplates();
    expect(
      templates.resourceTemplates.map((t: any) => t.uriTemplate),
    ).toContain('mcp://users/{id}');

    const templated: any = await client.readResource({ uri: 'mcp://users/42' });
    expect(templated.contents[0].text).toBe('{"id":"42"}');

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((p: any) => p.name)).toContain('intro');

    const prompt: any = await client.getPrompt({
      name: 'intro',
      arguments: { topic: 'MCP' },
    });
    expect(prompt.messages[0].content.text).toBe('Tell me about MCP');

    await client.close();
  });

  it('reports the request as sessionless and modern, with per-request client identity', async () => {
    const client = await createModernClient();
    const result: any = await client.callTool({
      name: 'whoami',
      arguments: {},
    });
    const seen = JSON.parse(result.content[0].text);

    expect(seen.era).toBe('modern');
    // Protocol sessions were removed in 2026-07-28.
    expect(seen.sessionId).toBeNull();
    expect(seen.protocolVersion).toBe(MODERN);
    // There is no initialize handshake — identity rides every request.
    expect(seen.clientName).toBe('modern-test-client');

    await client.close();
  });
});

describe('modern era — server/discover', () => {
  it('advertises the modern revision, capabilities and cache hints', async () => {
    const { status, json } = await rawPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: { _meta: envelope },
      },
      { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'server/discover' },
    );

    expect(status).toBe(200);
    expect(json.result.supportedVersions).toContain(MODERN);
    expect(json.result.capabilities.tools).toBeDefined();
    expect(json.result.resultType).toBe('complete');
    // server/discover is a CacheableResult: both hints are required.
    expect(typeof json.result.ttlMs).toBe('number');
    expect(['public', 'private']).toContain(json.result.cacheScope);
    // Post spec-PR-#3002 identity lives in _meta, not the result body.
    expect(json.result.serverInfo).toBeUndefined();
    expect(json.result._meta['io.modelcontextprotocol/serverInfo'].name).toBe(
      'test-mcp-server',
    );
  });
});

describe('modern era — envelope validation', () => {
  it('accepts a request that omits the optional clientInfo', async () => {
    const { status, json } = await rawPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' },
    );

    expect(status).toBe(200);
    expect(json.result.tools.length).toBeGreaterThan(0);
  });

  it('rejects an unsupported protocol version with -32022', async () => {
    const { status, json } = await rawPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2099-01-01',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' },
    );

    expect(status).toBe(400);
    expect(json.error.code).toBe(-32022);
    expect(json.error.data.supported).toContain(MODERN);
  });

  it('rejects a header/body protocol version mismatch with -32020', async () => {
    const { status, json } = await rawPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: envelope },
      },
      { 'MCP-Protocol-Version': '2025-06-18', 'Mcp-Method': 'tools/list' },
    );

    expect(status).toBe(400);
    expect(json.error.code).toBe(-32020);
  });

  it('rejects a malformed envelope with -32602', async () => {
    const { status, json } = await rawPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN,
            // clientCapabilities is REQUIRED and missing
          },
        },
      },
      { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'tools/list' },
    );

    expect(status).toBe(400);
    expect(json.error.code).toBe(-32602);
  });

  it('never answers an error with an empty body (clients would misclassify us as legacy)', async () => {
    const { status, json } = await rawPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2099-01-01',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      },
      { 'MCP-Protocol-Version': '2099-01-01', 'Mcp-Method': 'tools/list' },
    );

    expect(status).toBe(400);
    expect(json.jsonrpc).toBe('2.0');
    expect(json.error).toBeDefined();
    expect(typeof json.error.message).toBe('string');
  });
});

describe('modern era — request-scoped streaming', () => {
  it('delivers progress on a sessionless request', async () => {
    const client = await createModernClient();
    const seen: number[] = [];

    await client.callTool(
      { name: 'work', arguments: {} },
      { onprogress: (p: any) => seen.push(p.progress) },
    );

    expect(seen).toEqual([1, 2]);
    await client.close();
  });

  it('suppresses notifications/message when the request did not opt into logging', async () => {
    // Spec: "The server MUST NOT emit notifications/message for a request that
    // does not include this field."
    const { status, json } = await rawPost(
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'talk', arguments: {}, _meta: envelope },
      },
      {
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'talk',
      },
    );

    expect(status).toBe(200);
    // A plain JSON body proves no notification stream was opened.
    expect(json.result.content[0].text).toBe('logged');
  });

  it('emits notifications/message when the request opts in via logLevel', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'talk',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'talk',
          arguments: {},
          _meta: { ...envelope, 'io.modelcontextprotocol/logLevel': 'info' },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const body = await res.text();
    expect(body).toContain('notifications/message');
    expect(body).toContain('hello from the tool');
  });
});

describe('modern era — removed session operations', () => {
  it('answers GET with 405 and a JSON-RPC body', async () => {
    const res = await fetch(`http://localhost:${statelessPort}/mcp`, {
      method: 'GET',
    });
    expect(res.status).toBe(405);
    const json = JSON.parse(await res.text());
    expect(json.jsonrpc).toBe('2.0');
    expect(json.error).toBeDefined();
  });

  it('answers DELETE with 405 and a JSON-RPC body', async () => {
    const res = await fetch(`http://localhost:${statelessPort}/mcp`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(405);
    const json = JSON.parse(await res.text());
    expect(json.jsonrpc).toBe('2.0');
    expect(json.error).toBeDefined();
  });

  it('never mints an Mcp-Session-Id on a modern exchange', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': 'tools/list',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: { _meta: envelope },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeNull();
  });
});

describe('dual-era serving', () => {
  it('serves a legacy client and a modern client on the same endpoint, concurrently', async () => {
    // Default negotiation mode is 'legacy' — this is the 2025 handshake path.
    const legacy = new Client({ name: 'legacy-client', version: '1.0.0' });
    await legacy.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://localhost:${port}/mcp`),
      ),
    );

    const modern = await createModernClient();

    const [legacyTools, modernTools] = await Promise.all([
      legacy.listTools(),
      modern.listTools(),
    ]);

    expect(legacyTools.tools.map((t: any) => t.name)).toContain('greet');
    expect(modernTools.tools.map((t: any) => t.name)).toContain('greet');

    const [legacyCall, modernCall] = await Promise.all([
      legacy.callTool({ name: 'greet', arguments: { name: 'old' } }) as any,
      modern.callTool({ name: 'greet', arguments: { name: 'new' } }) as any,
    ]);

    expect(legacyCall.content[0].text).toBe('Hello, old!');
    expect(modernCall.content[0].text).toBe('Hello, new!');

    await legacy.close();
    await modern.close();
  });

  it('still gives the legacy client a session id', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'legacy-raw', version: '1' },
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('mcp-session-id')).toBeTruthy();
  });
});

describe('modern era — subscriptions/listen', () => {
  /** Opens a listen stream and yields decoded SSE `data:` payloads. */
  async function openListenStream(filter: Record<string, unknown>) {
    const controller = new AbortController();
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': 'subscriptions/listen',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'subscriptions/listen',
        params: { _meta: envelope, notifications: filter },
      }),
    });

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = '';

    /** Reads until one more JSON-RPC message arrives on the stream. */
    async function next(): Promise<any> {
      for (;;) {
        const match = /data: (.+)\n/.exec(buffered);
        if (match) {
          buffered = buffered.slice(match.index + match[0].length);
          return JSON.parse(match[1]);
        }
        const { value, done } = await reader.read();
        if (done) throw new Error('stream ended');
        buffered += decoder.decode(value, { stream: true });
      }
    }

    return {
      res,
      next,
      close: async () => {
        controller.abort();
        await reader.cancel().catch(() => undefined);
      },
    };
  }

  it('acknowledges the subscription first, tagged with its id', async () => {
    const stream = await openListenStream({ toolsListChanged: true });
    expect(stream.res.status).toBe(200);
    expect(stream.res.headers.get('content-type')).toContain(
      'text/event-stream',
    );

    const ack = await stream.next();
    // Spec: the ack MUST be the first message on the stream.
    expect(ack.method).toBe('notifications/subscriptions/acknowledged');
    expect(ack.params.notifications.toolsListChanged).toBe(true);
    expect(ack.params._meta['io.modelcontextprotocol/subscriptionId']).toBe(99);

    await stream.close();
  }, 20000);

  it('delivers tools/list_changed when a tool is registered at runtime', async () => {
    const stream = await openListenStream({ toolsListChanged: true });
    await stream.next(); // the ack

    strategy.registerTool({
      name: 'late-arrival',
      description: 'Registered after the subscription opened',
      parameters: z.object({}),
      handler: () => ({ content: [{ type: 'text', text: 'late' }] }),
    });

    const event = await stream.next();
    expect(event.method).toBe('notifications/tools/list_changed');
    expect(event.params._meta['io.modelcontextprotocol/subscriptionId']).toBe(
      99,
    );

    strategy.removeTool('late-arrival');
    await stream.close();
  }, 20000);

  it('does not deliver notification types the client did not opt into', async () => {
    // Spec: "The server MUST NOT send notification types the client has not
    // explicitly requested."
    const stream = await openListenStream({ promptsListChanged: true });
    const ack = await stream.next();
    expect(ack.params.notifications.toolsListChanged).toBeUndefined();

    strategy.registerTool({
      name: 'unwatched',
      description: 'Should not surface on a prompts-only subscription',
      parameters: z.object({}),
      handler: () => ({ content: [{ type: 'text', text: 'x' }] }),
    });

    // A tools change must not arrive; a prompts change must.
    strategy.registerPrompt({
      name: 'watched',
      description: 'Should surface',
    });

    const event = await stream.next();
    expect(event.method).toBe('notifications/prompts/list_changed');

    strategy.removeTool('unwatched');
    strategy.removePrompt('watched');
    await stream.close();
  }, 20000);
});
