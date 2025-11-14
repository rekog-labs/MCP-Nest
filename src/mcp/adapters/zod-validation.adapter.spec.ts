import { z } from 'zod';
import { ZodValidationAdapter } from './zod-validation.adapter';

describe('ZodValidationAdapter', () => {
  let adapter: ZodValidationAdapter;

  beforeEach(() => {
    adapter = new ZodValidationAdapter();
  });

  describe('validate', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number().optional(),
    });

    it('should return success for valid data', async () => {
      const result = await adapter.validate(schema, { name: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: 'test' });
      }
    });

    it('should return error for invalid data', async () => {
      const result = await adapter.validate(schema, { age: 25 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.fieldErrors.name).toBeDefined();
      }
    });
  });

  describe('toJsonSchema', () => {
    it('should convert a Zod schema to a JSON schema', async () => {
      const schema = z.object({
        name: z.string().describe('The name of the user'),
      });

      const jsonSchema = await adapter.toJsonSchema(schema);
      expect(jsonSchema).toEqual({
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the user',
          },
        },
        required: ['name'],
      });
    });
  });
});
