/**
 * `Origin` / `Host` header validation — DNS-rebinding protection.
 *
 * Spec (`draft/basic/transports/streamable-http#security-&-endpoint`): "Servers
 * MUST validate the `Origin` header on all incoming connections to prevent DNS
 * rebinding attacks. If the `Origin` header is present and invalid, servers MUST
 * respond with HTTP 403 Forbidden. The HTTP response body MAY comprise a JSON-RPC
 * error response that has no `id`."
 *
 * Two things make this less breaking than it reads, and both are asserted here:
 * the MUST only bites when `Origin` is *present* and invalid — an absent header
 * (every non-browser client) passes — and mcp-nest only enforces the check when
 * an allowlist is configured, because a correct allowlist can only be written by
 * whoever knows the hostnames the deployment answers on.
 *
 * The checks are era-independent: they run on the raw HTTP request before the body
 * is read and before an era is chosen, so there is nothing era-specific to
 * parameterise. They apply to POST, GET and DELETE alike.
 */
import { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import { McpController, Tool } from '@rekog/mcp-nest';
import {
  bootstrapMcpApp,
  createEraClient,
  MODERN_PROTOCOL_VERSION,
  StreamableHttpTransport,
} from './utils';

@McpController()
class GuardedTools {
  @Tool({
    name: 'ping',
    description: 'A tool behind the header checks',
    parameters: z.object({}),
  })
  ping() {
    return { content: [{ type: 'text', text: 'pong' }] };
  }
}

/** A minimal, valid modern-era `tools/list` POST with arbitrary extra headers. */
async function post(
  port: number,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
      'Mcp-Method': 'tools/list',
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
}

describe('Origin / Host validation (off by default)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app, port } = await bootstrapMcpApp({
      controllers: [GuardedTools],
      transports: [new StreamableHttpTransport({ statefulMode: true })],
    }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('accepts an origin that no allowlist would ever contain', async () => {
    const res = await post(port, { origin: 'https://evil.example.com' });
    expect(res.status).toBe(200);
  });
});

describe('Origin validation (allowedOrigins: localhost)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app, port } = await bootstrapMcpApp({
      controllers: [GuardedTools],
      transports: [
        new StreamableHttpTransport({
          statefulMode: true,
          security: { allowedOrigins: 'localhost' },
        }),
      ],
    }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects a present, disallowed Origin with 403', async () => {
    const res = await post(port, { origin: 'https://evil.example.com' });
    expect(res.status).toBe(403);
  });

  it('answers the 403 with a well-formed JSON-RPC error body and no meaningful id', async () => {
    // §5 of the era work: a 400/403 with an empty or unrecognized body makes a
    // conforming client conclude the server is legacy and retry `initialize`.
    const res = await post(port, { origin: 'https://evil.example.com' });
    const json = await res.json();
    expect(json.jsonrpc).toBe('2.0');
    expect(json.error).toBeDefined();
    expect(typeof json.error.message).toBe('string');
    expect(json.error.message).toContain('Origin');
    expect(json.id).toBeNull();
  });

  it('allows an Origin on the localhost allowlist, port-agnostically', async () => {
    const res = await post(port, { origin: `http://localhost:${port + 1}` });
    expect(res.status).toBe(200);
  });

  it('allows 127.0.0.1, which the localhost shorthand also covers', async () => {
    const res = await post(port, { origin: 'http://127.0.0.1:9999' });
    expect(res.status).toBe(200);
  });

  it('allows a request with NO Origin header — the MUST is only for present-and-invalid', async () => {
    const res = await post(port);
    expect(res.status).toBe(200);
  });

  it("rejects the literal 'null' origin of an opaque browser context", async () => {
    const res = await post(port, { origin: 'null' });
    expect(res.status).toBe(403);
  });

  it('applies to GET as well as POST', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'GET',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('applies to DELETE as well as POST', async () => {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: 'DELETE',
      headers: { origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
  });

  it('does not disturb ordinary clients, which send no Origin at all', async () => {
    for (const era of ['legacy', 'modern'] as const) {
      const client = await createEraClient(era, port);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toContain('ping');
      } finally {
        await client.close();
      }
    }
  });
});

describe('Origin validation (explicit hostname allowlist)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app, port } = await bootstrapMcpApp({
      controllers: [GuardedTools],
      transports: [
        new StreamableHttpTransport({
          security: { allowedOrigins: ['app.example.com'] },
        }),
      ],
    }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('allows the configured hostname over any scheme or port', async () => {
    const res = await post(port, { origin: 'https://app.example.com:8443' });
    expect(res.status).toBe(200);
  });

  it('rejects localhost, which this allowlist deliberately omits', async () => {
    const res = await post(port, { origin: 'http://localhost' });
    expect(res.status).toBe(403);
  });
});

describe('Host validation (allowedHosts)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app, port } = await bootstrapMcpApp({
      controllers: [GuardedTools],
      transports: [
        new StreamableHttpTransport({
          security: { allowedHosts: ['mcp.example.com'] },
        }),
      ],
    }));
  });
  afterAll(async () => {
    await app.close();
  });

  it('rejects the Host the loopback request actually carries', async () => {
    // `fetch` sets `Host: localhost:<port>`, which this allowlist excludes.
    const res = await post(port);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.message).toContain('Host');
  });

  it('accepts a Host on the allowlist, port-agnostically', async () => {
    const res = await post(port, { host: 'mcp.example.com:8080' });
    expect(res.status).toBe(200);
  });
});
