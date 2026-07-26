/**
 * Fastify parity on protocol revision `2026-07-28`.
 *
 * The modern serving entry needs Node-shaped request/response objects, which on
 * Fastify live behind `request.raw` / `reply.raw`. Our `HttpAdapterFactory`
 * unwraps them — this test proves the modern leg works on Fastify, not just on
 * Express. See `mcp-fastify-adapter.e2e.spec.ts` for the legacy-era equivalent.
 */
import { Controller, Injectable } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/client';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  MCP_STRATEGY,
  McpController,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import type { Context } from '@rekog/mcp-nest';

const MODERN = '2026-07-28';

@Injectable()
@Controller()
@McpController()
class FastifyTools {
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
    description: 'Reports progress',
    parameters: z.object({}),
  })
  async work(@Payload() _args: unknown, @Ctx() context: Context) {
    await context.reportProgress({ progress: 1, total: 1 });
    return { content: [{ type: 'text', text: 'done' }] };
  }
}

let app: any;
let port: number;

beforeAll(async () => {
  const strategy = new McpStrategy({
    name: 'fastify-modern-server',
    version: '0.0.1',
    transports: [new StreamableHttpTransport({ statefulMode: true })],
  });

  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [FastifyTools],
    providers: [{ provide: MCP_STRATEGY, useValue: strategy }],
  }).compile();

  app = moduleFixture.createNestApplication(new FastifyAdapter());
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(0, '0.0.0.0');

  const server = app.getHttpAdapter().getInstance().server;
  port = (server.address() as import('net').AddressInfo).port;
});

afterAll(async () => {
  await app?.close();
});

async function modernClient(): Promise<Client> {
  const client = new Client(
    { name: 'fastify-modern-client', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: MODERN } } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)),
  );
  return client;
}

describe('modern era on Fastify', () => {
  it('lists and calls tools', async () => {
    const client = await modernClient();

    const tools = await client.listTools();
    expect(tools.tools.map((t: any) => t.name).sort()).toEqual(['greet', 'work']);

    const result: any = await client.callTool({
      name: 'greet',
      arguments: { name: 'Fastify' },
    });
    expect(result.content[0].text).toBe('Hello, Fastify!');

    await client.close();
  });

  it('streams progress back on a sessionless request', async () => {
    const client = await modernClient();
    const seen: number[] = [];

    await client.callTool(
      { name: 'work', arguments: {} },
      { onprogress: (p: any) => seen.push(p.progress) },
    );

    expect(seen).toEqual([1]);
    await client.close();
  });

  it('serves server/discover', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'MCP-Protocol-Version': MODERN,
        'Mcp-Method': 'server/discover',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': MODERN,
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });

    expect(res.status).toBe(200);
    const json = JSON.parse(await res.text());
    expect(json.result.supportedVersions).toContain(MODERN);
  });
});
