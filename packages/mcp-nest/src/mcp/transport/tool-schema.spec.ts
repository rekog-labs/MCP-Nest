import { describe, it, expect } from 'bun:test';
import { z } from 'zod';
import * as v from 'valibot';
import { toStandardJsonSchema } from '@valibot/to-json-schema';
import { type } from 'arktype';
import { resolveToolSchema } from './tool-schema';

describe('resolveToolSchema', () => {
  describe('Zod', () => {
    const schema = z.object({ name: z.string(), age: z.number() });

    it('emits the same JSON Schema as z.toJSONSchema (draft-7, input)', () => {
      const resolved = resolveToolSchema(schema);
      expect(resolved.toJsonSchema('input')).toEqual(
        z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as Record<
          string,
          unknown
        >,
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
