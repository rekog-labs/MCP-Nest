/**
 * SEP-2243 `x-mcp-header` — refused at registration, not silently ignored.
 *
 * The spec lets a server designate tool params to be mirrored into
 * `Mcp-Param-{Name}` headers via an `x-mcp-header` property in the param's
 * schema. Clients **MUST** mirror them, and: "Any server that processes the
 * message body MUST validate that encoded header values, after decoding if
 * Base64-encoded, match the corresponding values in the request body. Servers
 * MUST reject requests with a `400 Bad Request` and JSON-RPC error code `-32020`
 * (`HeaderMismatch`) if any validation fails."
 *
 * The SDK implements that validation, but only for tools registered through
 * `McpServer.registerTool` — it is gated on the `toolInputSchemaJson` memo, which
 * only `registerTool` populates. mcp-nest registers raw `tools/call` handlers so
 * the NestJS pipeline (guards, pipes, interceptors) applies, so the memo is always
 * empty and the check would never run. Nothing in mcp-nest emits the annotation
 * today, but a user can put one in a raw JSON Schema tool or via Zod `.meta()` —
 * at which point clients faithfully mirror header values nobody verifies, which is
 * exactly the spoofing the MUST exists to prevent.
 *
 * So it is refused: a hard, immediate error beats a silent spec violation.
 * Implementing the full contract (base64 sentinel decoding, static-reachability
 * rules, numeric comparison) is a separate piece of work.
 */
import { z } from 'zod';
import { McpController, Tool } from '@rekog/mcp-nest';
import { bootstrapMcpApp, createEraClient } from './utils';

@McpController()
class HeaderMirroringTool {
  @Tool({
    name: 'search',
    description: 'Declares header mirroring mcp-nest cannot honour',
    parameters: {
      type: 'object',
      properties: { q: { type: 'string', 'x-mcp-header': true } },
      required: ['q'],
    },
  })
  search() {
    return { content: [{ type: 'text', text: 'ok' }] };
  }
}

@McpController()
class PlainTool {
  @Tool({
    name: 'plain',
    description: 'No header mirroring',
    parameters: z.object({ q: z.string() }),
  })
  plain() {
    return { content: [{ type: 'text', text: 'ok' }] };
  }
}

describe('SEP-2243 x-mcp-header is refused', () => {
  it('fails startup for a decorator tool that declares it', async () => {
    // Surfaces through `startAllMicroservices()`: the strategy reads tool
    // metadata in `listen()`, so the app never comes up with a tool whose
    // mirroring contract it cannot keep.
    await expect(
      bootstrapMcpApp({ controllers: [HeaderMirroringTool] }),
    ).rejects.toThrow(/x-mcp-header/);
  });

  it('throws from registerTool for a dynamically registered tool', async () => {
    const { app, strategy } = await bootstrapMcpApp({
      controllers: [PlainTool],
    });
    try {
      expect(() =>
        strategy.registerTool({
          name: 'dynamic-search',
          description: 'Registered at runtime',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string', 'x-mcp-header': true } },
          } as never,
          handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
        }),
      ).toThrow(/x-mcp-header/);
    } finally {
      await app.close();
    }
  });

  it('never serves the offending tool, even if the caller swallows the error', async () => {
    const { app, port, strategy } = await bootstrapMcpApp({
      controllers: [PlainTool],
    });
    try {
      try {
        strategy.registerTool({
          name: 'dynamic-search',
          description: 'Registered at runtime',
          parameters: {
            type: 'object',
            properties: { q: { type: 'string', 'x-mcp-header': true } },
          } as never,
          handler: () => ({ content: [{ type: 'text', text: 'ok' }] }),
        });
      } catch {
        // Deliberately swallowed — the check must run BEFORE the registry is
        // touched, so a caller ignoring the throw still cannot serve the tool.
      }
      const client = await createEraClient('modern', port);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toEqual(['plain']);
      } finally {
        await client.close();
      }
    } finally {
      await app.close();
    }
  });

  it('does not disturb tools that declare no mirroring', async () => {
    const { app, port } = await bootstrapMcpApp({ controllers: [PlainTool] });
    try {
      const client = await createEraClient('modern', port);
      try {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).toContain('plain');
      } finally {
        await client.close();
      }
    } finally {
      await app.close();
    }
  });
});
