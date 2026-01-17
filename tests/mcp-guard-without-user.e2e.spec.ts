import { INestApplication, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Tool } from '../src';
import type { Context } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { createSseClient } from './utils';

// Simple guard that just returns true without setting request.user
// This represents a guard that does authorization through other means
// (e.g., API key validation, IP whitelist, custom logic)
@Injectable()
class SimpleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // Just return true, no user object set
    // This is a valid use case for guards
    return true;
  }
}

// Simple greeting tool
@Injectable()
export class SimpleGreetingTool {
  @Tool({
    name: 'simple-hello',
    description: 'A simple greeting tool',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context) {
    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${name}!`,
        },
      ],
    };
  }
}

describe('E2E: MCP Server with Guard but no User', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-simple-guard-server',
          version: '0.0.1',
          // Guard is configured but doesn't set request.user
          guards: [SimpleGuard],
          capabilities: {
            resources: {},
            prompts: {},
            tools: {},
          },
        }),
      ],
      providers: [SimpleGreetingTool, SimpleGuard],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list tools even when guard does not set request.user', async () => {
    const client = await createSseClient(testPort);
    const tools = await client.listTools();

    // This should work because the guard returned true
    // Even though request.user is not set
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.find((t) => t.name === 'simple-hello')).toBeDefined();

    await client.close();
  });

  it('should execute tool even when guard does not set request.user', async () => {
    const client = await createSseClient(testPort);

    const result: any = await client.callTool({
      name: 'simple-hello',
      arguments: { name: 'Test' },
    });

    // This should work because the guard returned true
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Hello, Test!');

    await client.close();
  });
});
