
import { IValidationAdapter } from '../interfaces/validation-adapter.interface';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export class ZodValidationAdapter implements IValidationAdapter {
  async validate(
    schema: z.ZodTypeAny,
    data: any,
  ): Promise<{ success: true; data: any } | { success: false; error: any }> {
    const result = await schema.safeParseAsync(data);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error.flatten() };
  }

  async toJsonSchema(schema: z.ZodTypeAny): Promise<any> {
    return zodToJsonSchema(schema);
  }
}
