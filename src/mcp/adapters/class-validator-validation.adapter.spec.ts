import { IsString, IsNumber, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ClassValidatorAdapter } from './class-validator-validation.adapter';

class TestDto {
  @ApiProperty({ description: 'The name of the user' })
  @IsString()
  name: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  age?: number;
}

describe('ClassValidatorAdapter', () => {
  let adapter: ClassValidatorAdapter;

  beforeEach(() => {
    adapter = new ClassValidatorAdapter();
  });

  describe('validate', () => {
    it('should return success for valid data', async () => {
      const result = await adapter.validate(TestDto, { name: 'test' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBeInstanceOf(TestDto);
        expect(result.data.name).toEqual('test');
      }
    });

    it('should return error for invalid data', async () => {
      const result = await adapter.validate(TestDto, { age: 'not-a-number' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: 'name' }),
            expect.objectContaining({ path: 'age' }),
          ]),
        );
      }
    });
  });

  describe('toJsonSchema', () => {
    it('should convert a class to a JSON schema', async () => {
      const jsonSchema = await adapter.toJsonSchema(TestDto);
      expect(jsonSchema).toEqual({
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the user',
          },
          age: {
            type: 'number',
          },
        },
        required: ['name'],
      });
    });
  });
});
