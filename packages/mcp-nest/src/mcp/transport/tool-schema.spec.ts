import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import * as v from 'valibot';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import { type } from 'arktype';
import {
  assertNoMcpParamHeaderMirroring,
  resolveToolSchema,
} from './tool-schema';

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
      expect(emitted?.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
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
