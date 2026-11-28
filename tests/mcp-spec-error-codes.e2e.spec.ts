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
 *    The `tools/call` result follows the same envelope: on legacy a
 *    non-object value goes out as `structuredContent: { result: <value> }`
 *    (the SDK's `projectCallToolResult`), on modern it goes out as is. A root
 *    that is provably an object (a union of objects) is stamped
 *    `type: 'object'` and is not wrapped on either era, as in the SDK's own
 *    `McpServer`. The round-trip tests below drive the SDK client, which
 *    validates `structuredContent` against the advertised schema.
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

/** Raw JSON Schema output schemas that are NOT object-shaped. */
@McpController()
class NonObjectOutputSchemaTools {
  @Tool({
    name: 'array-output-tool',
    description:
      "Returns a top-level JSON array, per the spec's list_users example",
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

/** The same, authored in Zod (issue #128). */
@McpController()
class ZodNonObjectOutputSchemaTools {
  @Tool({
    name: 'zod-array-output-tool',
    description: 'Returns a top-level JSON array',
    parameters: z.object({}),
    outputSchema: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  async listUsers() {
    return [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ];
  }

  @Tool({
    name: 'zod-string-output-tool',
    description: 'Returns a bare JSON string',
    parameters: z.object({}),
    outputSchema: z.string(),
  })
  async bareString() {
    return 'just a string';
  }

  @Tool({
    name: 'zod-nullable-output-tool',
    description: 'Returns null',
    parameters: z.object({}),
    outputSchema: z.object({ id: z.string() }).nullable(),
  })
  async nothing() {
    return null;
  }

  @Tool({
    name: 'zod-union-output-tool',
    description: 'Returns one of two object shapes',
    parameters: z.object({}),
    outputSchema: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), a: z.string() }),
      z.object({ kind: z.literal('b'), b: z.number() }),
    ]),
  })
  async union() {
    return { kind: 'b', b: 2 };
  }

  @Tool({
    name: 'zod-transform-output-tool',
    description: 'Output schema with no JSON Schema form',
    parameters: z.object({}),
    outputSchema: z.object({ n: z.number() }).transform((v) => v),
  })
  async transformed() {
    return { n: 1 };
  }
}

describe.each(ERAS)('spec error codes and schemas (%s era)', (era: Era) => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    ({ app, port } = await bootstrapMcpApp({
      controllers: [
        ErrorCodeTools,
        NonObjectOutputSchemaTools,
        ZodNonObjectOutputSchemaTools,
      ],
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
            properties: {
              result: { type: 'array', items: { type: 'object' } },
            },
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

    it('advertises a Zod array outputSchema correctly for the era', async () => {
      const client = await createEraClient(era, port);
      try {
        const { tools } = await client.listTools();
        const tool = tools.find((t) => t.name === 'zod-array-output-tool');
        const natural = {
          type: 'array',
          items: { type: 'object', required: ['id', 'name'] },
        };
        expect(tool!.outputSchema).toMatchObject(
          era === 'modern'
            ? natural
            : {
                type: 'object',
                required: ['result'],
                properties: { result: natural },
              },
        );
      } finally {
        await client.close();
      }
    });

    it('stamps a Zod union of objects as an object root, unwrapped on both eras', async () => {
      const client = await createEraClient(era, port);
      try {
        const { tools } = await client.listTools();
        const tool = tools.find((t) => t.name === 'zod-union-output-tool');
        expect(tool!.outputSchema).toMatchObject({ type: 'object' });
        expect(tool!.outputSchema).not.toHaveProperty('properties.result');
      } finally {
        await client.close();
      }
    });

    it('lists a tool whose Zod outputSchema has no JSON Schema form, without one', async () => {
      const client = await createEraClient(era, port);
      try {
        const { tools } = await client.listTools();
        const tool = tools.find((t) => t.name === 'zod-transform-output-tool');
        expect(tool).toBeDefined();
        expect(tool!.outputSchema).toBeUndefined();
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

  describe('non-object structuredContent round-trips through the SDK client', () => {
    const wrap = (value: unknown) =>
      era === 'modern' ? value : { result: value };
    const users = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ];

    it.each([
      ['array-output-tool', wrap(users)],
      ['string-output-tool', wrap('just a string')],
      ['zod-array-output-tool', wrap(users)],
      ['zod-string-output-tool', wrap('just a string')],
      ['zod-nullable-output-tool', wrap(null)],
      // Provably an object: never wrapped.
      ['zod-union-output-tool', { kind: 'b', b: 2 }],
      // Not advertised; an object value needs no wrap.
      ['zod-transform-output-tool', { n: 1 }],
    ])('%s', async (name, expected) => {
      const client = await createEraClient(era, port);
      try {
        // `listTools` first: the client caches each tool's outputSchema from it
        // and validates `structuredContent` against that cache.
        await client.listTools();
        const result = await client.callTool({ name, arguments: {} });
        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual(expected);
      } finally {
        await client.close();
      }
    });
  });
});
