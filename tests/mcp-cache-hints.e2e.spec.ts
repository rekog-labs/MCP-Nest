/**
 * SEP-2549 cache hints (`ttlMs` / `cacheScope`) on `2026-07-28` cacheable results.
 *
 * The revision makes both fields REQUIRED on every cacheable result, and the SDK
 * fills them with a deliberately conservative `{ ttlMs: 0, cacheScope: 'private' }`
 * when the server offers nothing — which means no client ever caches `tools/list`,
 * i.e. the whole point of SEP-2549 is off until a server opts in. `cacheHints` on
 * `McpStrategy` is that opt-in.
 *
 * It lives on the strategy rather than on a transport because the SDK carries the
 * hint on the *server* (a symbol-keyed property the wire codec reads and strips),
 * so one setting covers streamable-HTTP and stdio alike — and, as asserted below,
 * legacy-era responses stay byte-identical either way.
 *
 * The security half is asserted too: `cacheScope: 'public'` on a per-caller-filtered
 * `tools/list` lets one principal's visible tool set be served to another out of a
 * shared cache, so the strategy warns at startup.
 */
import { INestApplication, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  McpController,
  McpStrategy,
  Resource,
  Tool,
  ToolScopes,
} from '@rekog/mcp-nest';
import {
  bootstrapMcpApp,
  createEraClient,
  MODERN_PROTOCOL_VERSION,
  StreamableHttpTransport,
} from './utils';

@McpController()
class CacheableTools {
  @Tool({
    name: 'plain',
    description: 'A tool visible to everyone',
    parameters: z.object({}),
  })
  plain() {
    return { content: [{ type: 'text', text: 'ok' }] };
  }

  /** Present so `resources/list` exists as an *unhinted* cacheable operation. */
  @Resource({ uri: 'mcp://cfg', name: 'cfg', description: 'Static config' })
  cfg() {
    return { contents: [{ uri: 'mcp://cfg', text: 'ok' }] };
  }
}

@McpController()
class ScopedTools {
  @Tool({
    name: 'scoped',
    description: 'Only visible to callers holding the scope',
    parameters: z.object({}),
  })
  @ToolScopes(['tools:secret'])
  scoped() {
    return { content: [{ type: 'text', text: 'secret' }] };
  }
}

/** Raw modern-era POST — the hints are result fields the client SDK does not surface. */
async function modernPost(
  port: number,
  method: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  const res = await fetch(`http://localhost:${port}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
      'Mcp-Method': method,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
          'io.modelcontextprotocol/clientCapabilities': {},
        },
      },
    }),
  });
  return JSON.parse(await res.text());
}

describe('SEP-2549 cache hints', () => {
  describe('defaults (no cacheHints configured)', () => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      ({ app, port } = await bootstrapMcpApp({
        controllers: [CacheableTools],
      }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('emits the conservative no-caching default', async () => {
      const { result } = await modernPost(port, 'tools/list');
      expect(result.ttlMs).toBe(0);
      expect(result.cacheScope).toBe('private');
    });
  });

  describe('configured hints', () => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      ({ app, port } = await bootstrapMcpApp({
        controllers: [CacheableTools],
        cacheHints: {
          'tools/list': { ttlMs: 60_000 },
          'prompts/list': { ttlMs: 5_000, cacheScope: 'public' },
        },
      }));
    });
    afterAll(async () => {
      await app.close();
    });

    it('applies a configured ttlMs to tools/list', async () => {
      const { result } = await modernPost(port, 'tools/list');
      expect(result.ttlMs).toBe(60_000);
      // A hint that sets only ttlMs must NOT quietly widen the scope: the
      // unset field still falls back to the conservative default.
      expect(result.cacheScope).toBe('private');
    });

    it('leaves an unhinted cacheable operation on the defaults', async () => {
      const { result } = await modernPost(port, 'resources/list');
      expect(result.ttlMs).toBe(0);
      expect(result.cacheScope).toBe('private');
    });

    it('does not leak cache fields into legacy-era responses', async () => {
      const client = await createEraClient('legacy', port);
      try {
        const result = (await client.listTools()) as Record<string, unknown>;
        // The 2025 revision has no cache fields at all; the hint rides a
        // symbol-keyed property that is never serialized.
        expect(result.ttlMs).toBeUndefined();
        expect(result.cacheScope).toBeUndefined();
      } finally {
        await client.close();
      }
    });
  });

  describe("cacheScope: 'public' on a per-caller tools/list", () => {
    let warnSpy: jest.SpyInstance;

    beforeEach(() => {
      // Spy BEFORE bootstrap — the warning fires during startAllMicroservices().
      warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
    });
    afterEach(() => {
      warnSpy?.mockRestore();
    });

    function warned(): boolean {
      return warnSpy.mock.calls
        .map((c) => String(c[0]))
        .some((m) => m.includes("cacheHints['tools/list'].cacheScope"));
    }

    it('warns when per-tool authorization filters the list', async () => {
      const { app } = await bootstrapMcpApp({
        controllers: [ScopedTools],
        cacheHints: { 'tools/list': { cacheScope: 'public' } },
      });
      expect(warned()).toBe(true);
      await app.close();
    });

    it('warns in freemium mode, where an undecorated tool needs a user', async () => {
      const { app } = await bootstrapMcpApp({
        controllers: [CacheableTools],
        allowUnauthenticatedAccess: true,
        cacheHints: { 'tools/list': { cacheScope: 'public' } },
      });
      expect(warned()).toBe(true);
      await app.close();
    });

    it('stays quiet when the list is the same for every caller', async () => {
      const { app } = await bootstrapMcpApp({
        controllers: [CacheableTools],
        cacheHints: { 'tools/list': { cacheScope: 'public' } },
      });
      expect(warned()).toBe(false);
      await app.close();
    });

    it("does not warn for a 'private' hint on a filtered list", async () => {
      const { app } = await bootstrapMcpApp({
        controllers: [ScopedTools],
        cacheHints: { 'tools/list': { ttlMs: 30_000, cacheScope: 'private' } },
      });
      expect(warned()).toBe(false);
      await app.close();
    });

    it('still honours the public hint it warned about — the warning is advisory', async () => {
      const { app, port } = await bootstrapMcpApp({
        controllers: [ScopedTools],
        cacheHints: { 'tools/list': { cacheScope: 'public' } },
      });
      const { result } = await modernPost(port, 'tools/list');
      expect(result.cacheScope).toBe('public');
      await app.close();
    });
  });

  it('rejects an invalid hint with a RangeError while starting', async () => {
    const strategy = new McpStrategy({
      name: 'bad-hints',
      version: '0.0.1',
      // ttlMs must be a non-negative safe integer.
      cacheHints: { 'tools/list': { ttlMs: -1 } },
      transports: [new StreamableHttpTransport()],
    });
    // Constructing the server is what validates, so the failure surfaces the
    // first time a server is built rather than at strategy construction.
    expect(() => (strategy as any).createServer()).toThrow(RangeError);
  });
});
