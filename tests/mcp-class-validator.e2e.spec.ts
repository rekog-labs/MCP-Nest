import { INestApplication, UsePipes, ValidationPipe } from '@nestjs/common';
import { Payload, RpcException } from '@nestjs/microservices';
import { IsInt, IsString, Min, MinLength } from 'class-validator';
import { z } from 'zod';
import { McpController, Tool } from '../src';
import { bootstrapMcpApp, createStreamableClient } from './utils';

class CreateUserDto {
  @IsString()
  @MinLength(3)
  name!: string;

  @IsInt()
  @Min(18)
  age!: number;
}

@McpController()
class ClassValidatorController {
  @Tool({
    name: 'create-user',
    description: 'Creates a user, validated with class-validator',
    // The advertised input schema (and the strategy's first-pass) only checks
    // shape/types; the business rules (@Min, @MinLength) are enforced by the pipe.
    parameters: z.object({ name: z.string(), age: z.number() }),
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      exceptionFactory: (errors) =>
        new RpcException(
          'Validation failed: ' +
            errors
              .map((e) => Object.values(e.constraints ?? {}).join(', '))
              .join('; '),
        ),
    }),
  )
  createUser(@Payload() dto: CreateUserDto) {
    return {
      content: [
        {
          type: 'text',
          text: `Created ${dto.name} (${dto.age}); instance=${dto instanceof CreateUserDto}`,
        },
      ],
    };
  }
}

describe('E2E: McpStrategy with class-validator ValidationPipe', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const ctx = await bootstrapMcpApp({
      name: 'class-validator-server',
      controllers: [ClassValidatorController],
    });
    app = ctx.app;
    port = ctx.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts valid input and transforms the payload into the DTO instance', async () => {
    const client = await createStreamableClient(port);
    const result = (await client.callTool({
      name: 'create-user',
      arguments: { name: 'Alice', age: 30 },
    })) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe('Created Alice (30); instance=true');
    await client.close();
  });

  it('rejects input that violates a class-validator constraint Zod does not check (@Min)', async () => {
    const client = await createStreamableClient(port);
    const result = (await client.callTool({
      name: 'create-user',
      arguments: { name: 'Bob', age: 10 },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    await client.close();
  });

  it('rejects input that violates @MinLength', async () => {
    const client = await createStreamableClient(port);
    const result = (await client.callTool({
      name: 'create-user',
      arguments: { name: 'A', age: 30 },
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Validation failed');
    await client.close();
  });
});
