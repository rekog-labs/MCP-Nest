import { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import { Payload } from '@nestjs/microservices';
import { McpController, Tool } from '../src';
import { bootstrapMcpApp, createStreamableClient } from './utils';

/**
 * Represents authentication that authorizes through means other than a user
 * object (API key, IP whitelist, custom logic). In the new model, that is
 * Express middleware that simply calls `next()` without setting `req.user`.
 *
 * With `allowUnauthenticatedAccess` left at its default (false) the
 * ToolAuthorizationService trusts the middleware that allowed the request
 * through and allows access even when no user object is present.
 */
const allowAllMiddleware = (_req: any, _res: any, next: () => void) => {
  // Authorizes the request without populating req.user.
  next();
};

// Simple greeting tool
@McpController()
export class SimpleGreetingTool {
  @Tool({
    name: 'simple-hello',
    description: 'A simple greeting tool',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello(@Payload() { name }: { name: string }) {
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
    const bootstrapped = await bootstrapMcpApp({
      name: 'test-simple-guard-server',
      controllers: [SimpleGreetingTool],
      // Gate (middleware) allows the request through but doesn't set
      // request.user.
      configure: (nestApp) => {
        nestApp.use(allowAllMiddleware);
      },
    });
    app = bootstrapped.app;
    testPort = bootstrapped.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list tools even when guard does not set request.user', async () => {
    const client = await createStreamableClient(testPort);
    const tools = await client.listTools();

    // This should work because the gate allowed the request through
    // even though request.user is not set
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.find((t) => t.name === 'simple-hello')).toBeDefined();

    await client.close();
  });

  it('should execute tool even when guard does not set request.user', async () => {
    const client = await createStreamableClient(testPort);

    const result: any = await client.callTool({
      name: 'simple-hello',
      arguments: { name: 'Test' },
    });

    // This should work because the gate allowed the request through
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Hello, Test!');

    await client.close();
  });
});
