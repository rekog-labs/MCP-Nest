import { INestApplication, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { z } from 'zod';
import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

import { McpModule, Tool } from '../src/mcp';
import { ClassValidatorAdapter, ZodValidationAdapter } from '../src/mcp/adapters';
import { createStreamableClient } from './utils';
import { McpError, ErrorCode, CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// --- Zod-based Tool ---
const zodToolSchema = z.object({
  name: z.string(),
});

@Injectable()
class ZodToolProvider {
  @Tool({
    name: 'zod_tool',
    description: 'A tool using Zod',
    parameters: zodToolSchema,
  })
  zodTool({ name }: z.infer<typeof zodToolSchema>) {
    return `Hello, ${name}`;
  }
}

// --- ClassValidator-based Tool ---
class ClassValidatorDto {
  @ApiProperty()
  @IsString()
  name: string;
}

@Injectable()
class ClassValidatorToolProvider {
  @Tool({
    name: 'class_validator_tool',
    description: 'A tool using class-validator',
    parameters: ClassValidatorDto,
  })
  classValidatorTool({ name }: ClassValidatorDto) {
    return `Hello, ${name}`;
  }
}

describe('Validation Adapter (e2e)', () => {
  let app: INestApplication;
  let port: number;

  describe('ZodValidationAdapter (default)', () => {
    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          McpModule.forRoot({
            name: 'zod-test-server',
            version: '1.0.0',
            // No adapter provided, should use default ZodValidationAdapter
          }),
        ],
        providers: [ZodToolProvider],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.listen(0);
      port = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should generate correct JSON schema for a Zod tool', async () => {
      const client = await createStreamableClient(port);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('zod_tool');
      expect(tools[0].inputSchema).toEqual({
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        type: 'object',
        properties: {
          name: {
            type: 'string',
          },
        },
        required: ['name'],
      });
      await client.close();
    });

    it('should execute a Zod tool with valid params', async () => {
      const client = await createStreamableClient(port);
      const result = (await client.callTool({
        name: 'zod_tool',
        arguments: { name: 'World' },
      })) as CallToolResult;
      expect(result.content[0].text).toContain('Hello, World');
      await client.close();
    });

    it('should fail a Zod tool with invalid params', async () => {
      const client = await createStreamableClient(port);
      await expect(
        client.callTool({ name: 'zod_tool', arguments: { name: 123 } }),
      ).rejects.toThrow(McpError);
      await client.close();
    });
  });

  describe('ClassValidatorAdapter', () => {
    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          McpModule.forRoot({
            name: 'class-validator-test-server',
            version: '1.0.0',
            validationAdapter: new ClassValidatorAdapter(),
          }),
        ],
        providers: [ClassValidatorToolProvider],
      }).compile();

      app = moduleRef.createNestApplication();
      await app.listen(0);
      port = (app.getHttpServer().address() as import('net').AddressInfo).port;
    });

    afterAll(async () => {
      await app.close();
    });

    it('should generate correct JSON schema for a class-validator tool', async () => {
      const client = await createStreamableClient(port);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('class_validator_tool');
      expect(tools[0].inputSchema).toEqual({
        type: 'object',
        properties: {
          name: {
            type: 'string',
          },
        },
        required: ['name'],
      });
      await client.close();
    });

    it('should execute a class-validator tool with valid params', async () => {
      const client = await createStreamableClient(port);
      const result = (await client.callTool({
        name: 'class_validator_tool',
        arguments: { name: 'Class' },
      })) as CallToolResult;
      expect(result.content[0].text).toContain('Hello, Class');
      await client.close();
    });

    it('should fail a class-validator tool with invalid params', async () => {
      const client = await createStreamableClient(port);
      try {
        await client.callTool({
          name: 'class_validator_tool',
          arguments: { name: 123 },
        });
        fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(McpError);
        expect(e.code).toBe(ErrorCode.InvalidParams);
      }
      await client.close();
    });
  });
});
