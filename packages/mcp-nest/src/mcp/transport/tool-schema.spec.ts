import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import * as v from 'valibot';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import { type } from 'arktype';
import {
  assertNoMcpParamHeaderMirroring,
  inlineRootRef,
  resolveToolSchema,
} from './tool-schema';

const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

describe('resolveToolSchema', () => {
  describe('Zod', () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it('emits the same JSON Schema as z.toJSONSchema (draft-2020-12, input)', () => {
      const resolved = resolveToolSchema(schema);
      expect(resolved.toJsonSchema('input')).toEqual(
        z.toJSONSchema(schema, {
          target: 'draft-2020-12',
          io: 'input',
        }) as Record<string, unknown>,
      );
    });

    // Guards the dialect itself, not just parity with Zod: SDK v2 clients
    // reject an outputSchema declaring any dialect but 2020-12.
    it('advertises the 2020-12 dialect', () => {
      const emitted = resolveToolSchema(schema).toJsonSchema('input');
      expect(emitted?.$schema).toBe(
        'https://json-schema.org/draft/2020-12/schema',
      );
    });

    it('returns undefined JSON Schema for a non-object Zod schema', () => {
      const resolved = resolveToolSchema(z.string());
      expect(resolved.toJsonSchema('input')).toBeUndefined();
    });

    it('accepts valid input', async () => {
      const result = await resolveToolSchema(schema).validate({
        name: 'a',
        age: 1,
      });
      expect(result).toEqual({ success: true, data: { name: 'a', age: 1 } });
    });

    it('rejects invalid input with a message containing the field path', async () => {
      const result = await resolveToolSchema(schema).validate({
        name: 123,
        age: 1,
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.message).toContain('[name]');
      }
    });
  });

  /**
   * Issue #296: from zod 4.5, a root schema with an `id` converts to
   * `{ $ref: '#/$defs/<id>', $defs }`, which has no root `type: "object"` and
   * makes clients reject `tools/list`. The expected values below are the
   * literal output of zod 4.4.3, so these hold on any zod 4.x.
   */
  describe('Zod schema with an id (.meta({ id }) / globalRegistry)', () => {
    it('advertises the object at the root, as zod <= 4.4 did', () => {
      const schema = z.object({ id: z.string() }).meta({ id: 'GetThingInput' });
      expect(resolveToolSchema(schema).toJsonSchema('input')).toEqual({
        $schema: DIALECT,
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
      });
    });

    it('does the same for the output projection', () => {
      const schema = z
        .object({ id: z.string() })
        .meta({ id: 'GetThingOutput' });
      expect(resolveToolSchema(schema).toJsonSchema('output')).toEqual({
        $schema: DIALECT,
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      });
    });

    it('keeps title/description from .meta()', () => {
      const schema = z
        .object({ id: z.string() })
        .meta({ id: 'X', title: 'T', description: 'D' });
      expect(resolveToolSchema(schema).toJsonSchema('input')).toEqual({
        $schema: DIALECT,
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        title: 'T',
        description: 'D',
      });
    });

    it('handles a schema registered in z.globalRegistry', () => {
      const schema = z.object({ q: z.string() });
      z.globalRegistry.add(schema, { id: 'RegisteredToolInput296' });
      try {
        expect(resolveToolSchema(schema).toJsonSchema('input')).toMatchObject({
          type: 'object',
          properties: { q: { type: 'string' } },
        });
        expect(
          resolveToolSchema(schema).toJsonSchema('input'),
        ).not.toHaveProperty('$ref');
      } finally {
        z.globalRegistry.remove(schema);
      }
    });

    it('keeps the other named definitions in $defs', () => {
      const Inner = z.object({ x: z.number() }).meta({ id: 'Inner296' });
      const schema = z.object({ a: Inner, b: Inner }).meta({ id: 'Outer296' });
      expect(resolveToolSchema(schema).toJsonSchema('input')).toEqual({
        $schema: DIALECT,
        type: 'object',
        properties: {
          a: { $ref: '#/$defs/Inner296' },
          b: { $ref: '#/$defs/Inner296' },
        },
        required: ['a', 'b'],
        $defs: {
          Inner296: {
            type: 'object',
            properties: { x: { type: 'number' } },
            required: ['x'],
          },
        },
      });
    });

    it('points a recursive self-reference at the root (#)', () => {
      const Node: z.ZodType = z
        .object({
          name: z.string(),
          get children() {
            return z.array(Node);
          },
        })
        .meta({ id: 'Node296' });
      expect(resolveToolSchema(Node).toJsonSchema('input')).toEqual({
        $schema: DIALECT,
        type: 'object',
        properties: {
          name: { type: 'string' },
          children: { type: 'array', items: { $ref: '#' } },
        },
        required: ['name', 'children'],
      });
    });

    it('still validates arguments with the Zod schema itself', async () => {
      const schema = z.object({ id: z.string() }).meta({ id: 'Validated296' });
      const resolved = resolveToolSchema(schema);
      expect(await resolved.validate({ id: 'a' })).toEqual({
        success: true,
        data: { id: 'a' },
      });
      expect((await resolved.validate({ id: 1 })).success).toBe(false);
    });

    it('inlines a root $ref from a Standard Schema converter too', () => {
      // A zod schema that fails `instanceof z.ZodType` (zod/mini, a second
      // zod copy) goes through `~standard.jsonSchema`.
      const zodSchema = z.object({ a: z.string() }).meta({ id: 'Std296' });
      const standardOnly = { '~standard': zodSchema['~standard'] };
      expect(resolveToolSchema(standardOnly).toJsonSchema('input')).toEqual({
        $schema: DIALECT,
        type: 'object',
        properties: { a: { type: 'string' } },
        required: ['a'],
      });
    });

    it('leaves a raw JSON Schema with a root $ref as authored', () => {
      const raw = {
        $ref: '#/$defs/A',
        $defs: { A: { type: 'object', properties: {} } },
      };
      expect(resolveToolSchema(raw).toJsonSchema('input')).toBe(raw);
    });
  });

  describe('Valibot (via toStandardJsonSchema)', () => {
    const schema = toStandardJsonSchema(
      v.object({ name: v.string(), age: v.number() }),
    );

    it('produces a JSON schema with the expected properties', () => {
      const json = resolveToolSchema(schema).toJsonSchema('input');
      expect(json).toMatchObject({
        type: 'object',
        properties: { name: { type: 'string' }, age: { type: 'number' } },
      });
    });

    it('validates correctly', async () => {
      const ok = await resolveToolSchema(schema).validate({
        name: 'a',
        age: 1,
      });
      expect(ok.success).toBe(true);
      const bad = await resolveToolSchema(schema).validate({
        name: 1,
        age: 1,
      });
      expect(bad.success).toBe(false);
    });
  });

  describe('ArkType', () => {
    const schema = type({ n: 'number' });

    it('produces a JSON schema via ~standard.jsonSchema.input', () => {
      const json = resolveToolSchema(schema).toJsonSchema('input');
      expect(json).toMatchObject({
        type: 'object',
        properties: { n: { type: 'number' } },
      });
    });

    it('validates correctly', async () => {
      const ok = await resolveToolSchema(schema).validate({ n: 1 });
      expect(ok.success).toBe(true);
      const bad = await resolveToolSchema(schema).validate({ n: 'x' });
      expect(bad.success).toBe(false);
    });
  });

  describe('Raw JSON Schema object', () => {
    const schema = {
      type: 'object',
      properties: { n: { type: 'number' } },
      required: ['n'],
    };

    it('returns the schema object as-is', () => {
      expect(resolveToolSchema(schema).toJsonSchema('input')).toEqual(schema);
    });

    it('validates against it', async () => {
      const ok = await resolveToolSchema(schema).validate({ n: 1 });
      expect(ok.success).toBe(true);
      const bad = await resolveToolSchema(schema).validate({ n: 'x' });
      expect(bad.success).toBe(false);
    });

    it('accepts an empty schema (accept anything)', async () => {
      const resolved = resolveToolSchema({});
      expect(resolved.toJsonSchema('input')).toEqual({});
      const ok = await resolved.validate({ anything: true });
      expect(ok.success).toBe(true);
    });
  });

  describe('bare Standard Schema without jsonSchema', () => {
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'custom-vendor',
        validate: (value: unknown) => ({ value }),
      },
    };

    it('throws mentioning the vendor and ~standard.jsonSchema', () => {
      const resolved = resolveToolSchema(schema);
      expect(() => resolved.toJsonSchema('input')).toThrow(
        /custom-vendor[\s\S]*~standard\.jsonSchema/,
      );
    });
  });
});

/**
 * SEP-2243 header mirroring is a two-sided contract mcp-nest cannot hold up: the
 * SDK's validation only runs for tools registered through `McpServer.registerTool`,
 * and mcp-nest registers raw request handlers. Rather than let clients mirror
 * headers nothing verifies, an `x-mcp-header` annotation is refused outright.
 */
describe('assertNoMcpParamHeaderMirroring', () => {
  it('passes an ordinary Zod schema', () => {
    expect(() =>
      assertNoMcpParamHeaderMirroring(
        z.object({ q: z.string() }),
        "@Tool({ name: 'search' })",
      ),
    ).not.toThrow();
  });

  it('rejects a raw JSON Schema declaring x-mcp-header on a property', () => {
    expect(() =>
      assertNoMcpParamHeaderMirroring(
        {
          type: 'object',
          properties: { q: { type: 'string', 'x-mcp-header': true } },
        },
        "@Tool({ name: 'search' })",
      ),
    ).toThrow(/x-mcp-header/);
  });

  it('names the tool and the offending location in the message', () => {
    expect(() =>
      assertNoMcpParamHeaderMirroring(
        {
          type: 'object',
          properties: { q: { type: 'string', 'x-mcp-header': true } },
        },
        "@Tool({ name: 'search' })",
      ),
    ).toThrow(/'search'[\s\S]*\/properties\/q\/x-mcp-header/);
  });

  it('rejects a Zod schema that smuggles it in through .meta()', () => {
    expect(() =>
      assertNoMcpParamHeaderMirroring(
        z.object({
          q: z.string().meta({ 'x-mcp-header': true }),
        }),
        "@Tool({ name: 'search' })",
      ),
    ).toThrow(/x-mcp-header/);
  });

  it('rejects it outside the statically reachable properties chain too', () => {
    // The spec makes an annotation anywhere but a statically reachable
    // `properties` chain an invalid tool definition, so finding one under
    // `oneOf` is equally grounds to refuse.
    expect(() =>
      assertNoMcpParamHeaderMirroring(
        {
          type: 'object',
          properties: {
            q: { oneOf: [{ type: 'string', 'x-mcp-header': true }] },
          },
        },
        "@Tool({ name: 'search' })",
      ),
    ).toThrow(/x-mcp-header/);
  });

  it('explains why, and what to do instead', () => {
    let message = '';
    try {
      assertNoMcpParamHeaderMirroring(
        { type: 'object', properties: { q: { 'x-mcp-header': true } } },
        "@Tool({ name: 'search' })",
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('-32020');
    expect(message).toContain('registerTool');
    expect(message).toContain('request body');
  });

  it('stays silent for a schema it cannot project to JSON Schema', () => {
    // That failure has its own, far more useful message at `tools/list` time;
    // pre-empting it here would replace a good error with a confusing one.
    const opaque = {
      '~standard': {
        version: 1 as const,
        vendor: 'custom-vendor',
        validate: (value: unknown) => ({ value }),
      },
    };
    expect(() =>
      assertNoMcpParamHeaderMirroring(opaque, "@Tool({ name: 'x' })"),
    ).not.toThrow();
  });

  it('terminates on a cyclic raw JSON Schema', () => {
    const cyclic: Record<string, unknown> = { type: 'object' };
    cyclic.properties = { self: cyclic };
    expect(() =>
      assertNoMcpParamHeaderMirroring(cyclic, "@Tool({ name: 'x' })"),
    ).not.toThrow();
  });
});

describe('inlineRootRef', () => {
  const body = { type: 'object', properties: { a: { type: 'string' } } };

  it('returns a schema without a root $ref unchanged (same object)', () => {
    const json = { $schema: DIALECT, ...body };
    expect(inlineRootRef(json)).toBe(json);
  });

  it('decodes JSON Pointer escapes in the definition name', () => {
    expect(
      inlineRootRef({
        $ref: '#/$defs/a~1b c~0d',
        $defs: { 'a/b c~d': body },
      }),
    ).toEqual(body);
  });

  it('decodes a percent-encoded definition name', () => {
    expect(
      inlineRootRef({ $ref: '#/$defs/a%20b', $defs: { 'a b': body } }),
    ).toEqual(body);
  });

  it('rewrites refs into the inlined definition, also from other $defs', () => {
    expect(
      inlineRootRef({
        $ref: '#/$defs/Root',
        $defs: {
          Root: {
            type: 'object',
            properties: {
              child: { $ref: '#/$defs/Child' },
              name: { $ref: '#/$defs/Root/properties/label' },
              label: { type: 'string' },
            },
          },
          Child: {
            type: 'object',
            properties: { parent: { $ref: '#/$defs/Root' } },
          },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        child: { $ref: '#/$defs/Child' },
        name: { $ref: '#/properties/label' },
        label: { type: 'string' },
      },
      $defs: {
        Child: {
          type: 'object',
          properties: { parent: { $ref: '#' } },
        },
      },
    });
  });

  it('does not touch data values or property names that look like $ref', () => {
    const data = { $ref: '#/$defs/Root' };
    expect(
      inlineRootRef({
        $ref: '#/$defs/Root',
        $defs: {
          Root: {
            type: 'object',
            properties: {
              $ref: { type: 'string', default: '#/$defs/Root' },
              default: { $ref: '#/$defs/Root' },
              blob: { type: 'object', default: data, examples: [data] },
              fixed: { const: data, enum: [data] },
            },
          },
        },
      }),
    ).toEqual({
      type: 'object',
      properties: {
        $ref: { type: 'string', default: '#/$defs/Root' },
        default: { $ref: '#' },
        blob: { type: 'object', default: data, examples: [data] },
        fixed: { const: data, enum: [data] },
      },
    });
  });

  it.each([
    [
      'a root keyword next to $ref (applies together with it in 2020-12)',
      { $ref: '#/$defs/A', description: 'x', $defs: { A: body } },
    ],
    ['a $ref to a missing definition', { $ref: '#/$defs/B', $defs: { A: body } }],
    [
      'a $ref into the middle of a definition',
      { $ref: '#/$defs/A/properties/a', $defs: { A: body } },
    ],
    ['a $ref outside $defs', { $ref: '#/definitions/A', definitions: { A: body } }],
    ['an external $ref', { $ref: 'https://example.com/s.json' }],
    [
      'a definition with its own $id',
      { $ref: '#/$defs/A', $defs: { A: { ...body, $id: 'urn:a' } } },
    ],
    [
      'a definition with nested $defs',
      { $ref: '#/$defs/A', $defs: { A: { ...body, $defs: {} } } },
    ],
  ])('leaves %s unchanged', (_label, json) => {
    expect(inlineRootRef(json as Record<string, unknown>)).toBe(json);
  });
});
