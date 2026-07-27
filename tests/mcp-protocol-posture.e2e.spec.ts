/**
 * `StreamableHttpTransport({ protocol })` — which protocol eras an endpoint serves.
 *
 * The default (`'dual'`) is covered by `mcp-modern-era.e2e.spec.ts`; this file
 * covers the two narrowing postures.
 */
import { Controller, Injectable } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { McpController, Tool } from '@rekog/mcp-nest';
import { bootstrapMcpApp, StreamableHttpTransport } from './utils';

const MODERN = '2026-07-28';

@Injectable()
@Controller()
@McpController()
class Greeting {
  @Tool({
    name: 'hello',
    description: 'Says hello',
    parameters: z.object({}),
  })
  hello(@Payload() _args: unknown) {
    return { content: [{ type: 'text', text: 'hi' }] };
  }
}

let modernOnlyApp: any;
let modernOnlyPort: number;
let legacyOnlyApp: any;
let legacyOnlyPort: number;

beforeAll(async () => {
  const modernOnly = await bootstrapMcpApp({
    controllers: [Greeting],
    transports: [new StreamableHttpTransport({ protocol: 'modern-only' })],
  });
  modernOnlyApp = modernOnly.app;
  modernOnlyPort = modernOnly.port;

  const legacyOnly = await bootstrapMcpApp({
    controllers: [Greeting],
    transports: [
      new StreamableHttpTransport({
        protocol: 'legacy-only',
        statefulMode: true,
      }),
    ],
  });
  legacyOnlyApp = legacyOnly.app;
  legacyOnlyPort = legacyOnly.port;
});

afterAll(async () => {
  await modernOnlyApp?.close();
  await legacyOnlyApp?.close();
});

const modernBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': MODERN,
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  },
};

const legacyInitBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'legacy', version: '1' },
  },
};

async function post(
  port: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
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
  // A stateful legacy endpoint answers over SSE, so unwrap the frame if present.
  const payload = /data: (.+)/.exec(text)?.[1] ?? text;
  let json: any;
  try {
    json = JSON.parse(payload);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

describe("protocol: 'modern-only'", () => {
  it('serves modern clients', async () => {
    const client = new Client(
      { name: 'modern', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: MODERN } } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`http://localhost:${modernOnlyPort}/mcp`),
      ),
    );
    const tools = await client.listTools();
    expect(tools.tools.map((t: any) => t.name)).toContain('hello');
    await client.close();
  });

  it('rejects a legacy initialize by naming the revisions it does serve', async () => {
    // Spec: a modern-only server SHOULD name its supported versions in the error
    // it returns to an initialize — legacy clients have no fall-forward path, so
    // this may be the only diagnostic a user ever sees.
    const { status, json } = await post(modernOnlyPort, legacyInitBody);

    expect(status).toBe(400);
    expect(json.error.code).toBe(-32022);
    expect(json.error.data.supported).toContain(MODERN);
  });
});

describe("protocol: 'legacy-only'", () => {
  it('serves legacy clients, sessions and all', async () => {
    const { status, json } = await post(legacyOnlyPort, legacyInitBody);
    expect(status).toBe(200);
    expect(json.result.protocolVersion).toBe('2025-06-18');
  });

  it('does not serve modern clients', async () => {
    const { status } = await post(legacyOnlyPort, modernBody, {
      'MCP-Protocol-Version': MODERN,
      'Mcp-Method': 'tools/list',
    });

    // The modern leg is not built at all, so the request falls through to the
    // 2025 wiring, which has no idea what this revision is.
    expect(status).not.toBe(200);
  });
});

describe('logging capability declaration', () => {
  it('is declared by default, and can be opted out of explicitly', async () => {
    const withLogging = await bootstrapMcpApp({
      controllers: [Greeting],
      transports: [new StreamableHttpTransport({})],
    });
    const withoutLogging = await bootstrapMcpApp({
      controllers: [Greeting],
      // Explicitly present-but-undefined opts out.
      capabilities: { logging: undefined },
      transports: [new StreamableHttpTransport({})],
    });

    const discover = async (port: number) => {
      const { json } = await post(
        port,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'server/discover',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': MODERN,
              'io.modelcontextprotocol/clientCapabilities': {},
            },
          },
        },
        { 'MCP-Protocol-Version': MODERN, 'Mcp-Method': 'server/discover' },
      );
      return json.result.capabilities;
    };

    expect(await discover(withLogging.port)).toHaveProperty('logging');
    expect(await discover(withoutLogging.port)).not.toHaveProperty('logging');

    await withLogging.app.close();
    await withoutLogging.app.close();
  });
});
