/**
 * OpenTelemetry trace context on `McpContext` (SEP-414).
 *
 * `2026-07-28` reserves `traceparent`, `tracestate` and `baggage` as `_meta` keys —
 * the one sanctioned exception to the reverse-DNS prefix rule — and pins their
 * values to the W3C Trace Context / W3C Baggage formats. `context.getTraceContext()`
 * surfaces them to handlers.
 *
 * They are ordinary `params._meta` keys rather than modern-envelope fields, so the
 * accessor works on **both** eras; the revision only reserved the names. That is
 * what `describe.each(ERAS)` pins here. In practice only a SEP-414-aware client
 * sends them, which is why the raw-POST tests below construct the `_meta` by hand.
 */
import { INestApplication } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { McpController, Prompt, Resource, Tool } from '@rekog/mcp-nest';
import type { Context } from '@rekog/mcp-nest';
import {
  bootstrapMcpApp,
  createEraClient,
  ERAS,
  MODERN_PROTOCOL_VERSION,
  StreamableHttpTransport,
  type Era,
} from './utils';

const TRACEPARENT = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
const TRACESTATE = 'vendor1=value1,vendor2=value2';
const BAGGAGE = 'userId=alice,serverRegion=us-east-1';

/** Echoes whatever trace context reached the handler, so tests can assert on it. */
function echo(context: Context) {
  const trace = (context as any).getTraceContext();
  return { content: [{ type: 'text', text: JSON.stringify(trace) }] };
}

@McpController()
class TracedCapabilities {
  @Tool({
    name: 'traced',
    description: 'Echoes the propagated trace context',
    parameters: z.object({}),
  })
  traced(@Payload() _args: unknown, @Ctx() context: Context) {
    return echo(context);
  }

  @Resource({
    uri: 'mcp://traced',
    name: 'traced-resource',
    description: 'Echoes the propagated trace context',
  })
  tracedResource(@Payload() _args: unknown, @Ctx() context: Context) {
    const trace = (context as any).getTraceContext();
    return {
      contents: [{ uri: 'mcp://traced', text: JSON.stringify(trace) }],
    };
  }

  @Prompt({ name: 'traced-prompt', description: 'Echoes the trace context' })
  tracedPrompt(@Payload() _args: unknown, @Ctx() context: Context) {
    const trace = (context as any).getTraceContext();
    return {
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: JSON.stringify(trace) },
        },
      ],
    };
  }
}

describe.each(ERAS)('trace context on _meta (%s era)', (era: Era) => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app, port } = await bootstrapMcpApp({
      controllers: [TracedCapabilities],
      // Stateless, so a single self-contained POST is a complete legacy
      // exchange — no `initialize` and no `Mcp-Session-Id` to carry.
      transports: [new StreamableHttpTransport({ statefulMode: false })],
    }));
  });
  afterAll(async () => {
    await app.close();
  });

  /**
   * Calls a method with hand-built `params._meta`. The client SDK owns `_meta` on
   * its own requests (it is where the modern envelope lives), so the trace keys go
   * on the wire by hand — which is also what a real tracer-instrumented client
   * does.
   */
  async function callWithMeta(
    method: string,
    params: Record<string, unknown>,
    trace: Record<string, string>,
  ): Promise<any> {
    const envelope =
      era === 'modern'
        ? {
            'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
            'io.modelcontextprotocol/clientCapabilities': {},
          }
        : {};
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    if (era === 'modern') {
      headers['MCP-Protocol-Version'] = MODERN_PROTOCOL_VERSION;
      headers['Mcp-Method'] = method;
      // SEP-2243: whichever of `params.name` / `params.uri` the method carries
      // MUST also appear in `Mcp-Name`, or the SDK answers -32020.
      const name = params.name ?? params.uri;
      if (typeof name === 'string') headers['Mcp-Name'] = name;
    } else {
      // No envelope and no SEP-2243 headers: this is a plain 2025-era request,
      // which the stateless legacy leg answers on its own.
      headers['MCP-Protocol-Version'] = '2025-06-18';
    }
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: { ...params, _meta: { ...envelope, ...trace } },
      }),
    });
    return JSON.parse(await res.text());
  }

  it('surfaces traceparent, tracestate and baggage to a tool', async () => {
    const body = await callWithMeta(
      'tools/call',
      { name: 'traced', arguments: {} },
      { traceparent: TRACEPARENT, tracestate: TRACESTATE, baggage: BAGGAGE },
    );
    expect(JSON.parse(body.result.content[0].text)).toEqual({
      traceparent: TRACEPARENT,
      tracestate: TRACESTATE,
      baggage: BAGGAGE,
    });
  });

  it('omits the keys the client did not send rather than setting them undefined', async () => {
    const body = await callWithMeta(
      'tools/call',
      { name: 'traced', arguments: {} },
      { traceparent: TRACEPARENT },
    );
    const trace = JSON.parse(body.result.content[0].text);
    expect(trace).toEqual({ traceparent: TRACEPARENT });
    expect('tracestate' in trace).toBe(false);
    expect('baggage' in trace).toBe(false);
  });

  it('returns an empty object when nothing was propagated', async () => {
    const client = await createEraClient(era, port);
    try {
      const result: any = await client.callTool({
        name: 'traced',
        arguments: {},
      });
      expect(JSON.parse(result.content[0].text)).toEqual({});
    } finally {
      await client.close();
    }
  });

  it('ignores a non-string value instead of handing it to a tracer', async () => {
    const body = await callWithMeta(
      'tools/call',
      { name: 'traced', arguments: {} },
      { traceparent: 42 as unknown as string },
    );
    expect(JSON.parse(body.result.content[0].text)).toEqual({});
  });

  it('reaches resource handlers too', async () => {
    const body = await callWithMeta(
      'resources/read',
      { uri: 'mcp://traced' },
      { traceparent: TRACEPARENT },
    );
    expect(JSON.parse(body.result.contents[0].text)).toEqual({
      traceparent: TRACEPARENT,
    });
  });

  it('reaches prompt handlers too', async () => {
    const body = await callWithMeta(
      'prompts/get',
      { name: 'traced-prompt', arguments: {} },
      { baggage: BAGGAGE },
    );
    expect(JSON.parse(body.result.messages[0].content.text)).toEqual({
      baggage: BAGGAGE,
    });
  });
});
