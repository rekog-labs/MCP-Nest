/**
 * Spec-conformance tests for the error codes and schema shapes that the
 * `2026-07-28` revision pins down.
 *
 * Two things are asserted here, both of which a conforming *modern* client
 * relies on and a 2025-era client never noticed:
 *
 * 1. **Unknown tool / unknown prompt answer `-32602`, never `-32601`.** The
 *    transport reserves `-32601` for "the server does not implement the
 *    requested RPC method" (answered with HTTP 404) and clients use it for
 *    era/transport detection, so emitting it for a bad `params.name` invites a
 *    client to conclude `tools/call` itself is unsupported.
 *
 * 2. **`outputSchema` is advertised as authored.** SEP-2106 widened
 *    `structuredContent` to any JSON value and the spec documents array output
 *    schemas explicitly. mcp-nest used to force `type: 'object'` onto every
 *    output schema, which silently destroyed non-object ones — `{type:'array',
 *    items:{…}}` became `{items:{…}, type:'object'}`.
 *
 *    The two eras differ here, legitimately, and both are pinned below:
 *    - **modern**: the schema goes out verbatim.
 *    - **legacy**: the SDK's 2025 wire codec wraps a non-object schema in the
 *      era's envelope (`wrapOutputSchemaForLegacy`) — `{type:'object',
 *      properties:{result:<natural>}, required:['result']}` — because the 2025
 *      revision only permitted object output schemas. That is the SDK doing the
 *      right era-appropriate thing, not us corrupting the schema.
 *
 * Known SDK limitation (deliberately not asserted): a *result* whose
 * `structuredContent` is a non-object JSON value is rejected client-side by
 * `@modelcontextprotocol/client@2.0.0-beta.5`, whose `CallToolResult` schema
 * still types the field as `z.record(z.string(), z.unknown())`. SEP-2106's
 * widening is honored on the server (the SDK even ships
 * `appendTextFallbackForNonObject`) but not yet in the client's result
 * validation, so an end-to-end array-`structuredContent` round-trip cannot pass
 * today no matter what the server emits. Advertising the schema correctly is
 * still the right thing to do and is what this suite locks in.
 */
import { INestApplication } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { McpController, Prompt, Tool } from '@rekog/mcp-nest';
import { bootstrapMcpApp, createEraClient, ERAS, type Era } from './utils';

@McpController()
class ErrorCodeTools {
  @Tool({
    name: 'known-tool',
    description: 'A tool that exists',
    parameters: z.object({}),
  })
  async known() {
    return { content: [{ type: 'text', text: 'ok' }] };
  }

  @Prompt({
    name: 'known-prompt',
    description: 'A prompt that exists',
  })
  async knownPrompt() {
    return { messages: [] };
  }
}

/**
 * Output schemas that are NOT object-shaped. Only the Standard Schema and raw
 * JSON Schema paths can produce these — the Zod path normalizes non-object
 * schemas away before they are advertised.
 */
@McpController()
class NonObjectOutputSchemaTools {
  @Tool({
    name: 'array-output-tool',
    description: 'Returns a top-level JSON array, per the spec\'s list_users example',
    parameters: z.object({}),
    outputSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, name: { type: 'string' } },
        required: ['id', 'name'],
      },
    },
  })
  async listUsers() {
    return [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ];
  }

  @Tool({
    name: 'string-output-tool',
    description: 'Returns a bare JSON string',
    parameters: z.object({}),
    outputSchema: { type: 'string' },
  })
  async bareString() {
    return 'just a string';
  }
}

describe.each(ERAS)('spec error codes and schemas (%s era)', (era: Era) => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app, port } = await bootstrapMcpApp({
      controllers: [ErrorCodeTools, NonObjectOutputSchemaTools],
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  describe('unknown tool / prompt use -32602 (InvalidParams)', () => {
    it('answers an unknown tool with -32602, not -32601', async () => {
      const client = await createEraClient(era, port);
      try {
        await expect(
          client.callTool({ name: 'no-such-tool', arguments: {} }),
        ).rejects.toMatchObject({ code: -32602 });
      } finally {
        await client.close();
      }
    });

    it('answers an unknown prompt with -32602, not -32601', async () => {
      const client = await createEraClient(era, port);
      try {
        await expect(
          client.getPrompt({ name: 'no-such-prompt', arguments: {} }),
        ).rejects.toMatchObject({ code: -32602 });
      } finally {
        await client.close();
      }
    });

    it('never emits -32601 for a bad params.name', async () => {
      const client = await createEraClient(era, port);
      try {
        const error = await client
          .callTool({ name: 'no-such-tool', arguments: {} })
          .then(
            () => null,
            (e: unknown) => e as { code?: number },
          );
        expect(error).not.toBeNull();
        // -32601 is what a modern client reads as "this RPC method does not
        // exist here", which would be a lie about `tools/call`.
        expect(error!.code).not.toBe(-32601);
      } finally {
        await client.close();
      }
    });
  });

  describe('outputSchema is advertised as authored', () => {
    /**
     * The regression this guards: mcp-nest spread `type: 'object'` LAST over the
     * resolved schema, so an array schema arrived as `{items:{…},
     * type:'object'}` — `type` overwritten, `items` orphaned. Asserting the
     * `items` keyword survives alongside the right `type` is what catches a
     * reintroduction on the modern era; on legacy the SDK's own envelope is
     * asserted instead.
     */
    it('advertises a top-level array outputSchema correctly for the era', async () => {
      const client = await createEraClient(era, port);
      try {
        const { tools } = await client.listTools();
        const tool = tools.find((t) => t.name === 'array-output-tool');
        expect(tool).toBeDefined();

        if (era === 'modern') {
          expect(tool!.outputSchema).toMatchObject({
            type: 'array',
            items: { type: 'object' },
          });
        } else {
          // 2025 envelope: the natural schema moves under `properties.result`
          // and keeps its own `type`/`items` intact there.
          expect(tool!.outputSchema).toMatchObject({
            type: 'object',
            required: ['result'],
            properties: { result: { type: 'array', items: { type: 'object' } } },
          });
        }
      } finally {
        await client.close();
      }
    });

    it('advertises a scalar outputSchema correctly for the era', async () => {
      const client = await createEraClient(era, port);
      try {
        const { tools } = await client.listTools();
        const tool = tools.find((t) => t.name === 'string-output-tool');
        expect(tool).toBeDefined();

        if (era === 'modern') {
          expect(tool!.outputSchema).toEqual({ type: 'string' });
        } else {
          expect(tool!.outputSchema).toMatchObject({
            type: 'object',
            required: ['result'],
            properties: { result: { type: 'string' } },
          });
        }
      } finally {
        await client.close();
      }
    });

    it('does not invent an outputSchema for tools that declare none', async () => {
      const client = await createEraClient(era, port);
      try {
        const { tools } = await client.listTools();
        const known = tools.find((t) => t.name === 'known-tool');
        expect(known).toBeDefined();
        expect(known!.outputSchema).toBeUndefined();
      } finally {
        await client.close();
      }
    });
  });
});
