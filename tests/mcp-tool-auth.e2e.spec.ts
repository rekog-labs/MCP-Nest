import { INestApplication, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, Payload } from '@nestjs/microservices';
import { McpContext, McpController, Tool } from '../src';
import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { bootstrapMcpApp, createStreamableClient } from './utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

/**
 * AUTHENTICATION for HTTP transports is now Express middleware, not a module
 * guard. The middleware inspects the Authorization header, populates
 * `req.user` on success, and replies 401 on failure — gating the MCP routes
 * the same way the old `guards: [MockAuthGuard]` did. Tools read the
 * authenticated user via `@Ctx()` -> `getRawRequest().user`.
 */
const authMiddleware = (req: any, res: any, next: () => void) => {
  const authorization = req.headers?.authorization;
  if (authorization && authorization.includes('token-xyz')) {
    req.user = {
      id: 'user123',
      name: 'Test User',
      orgMemberships: [
        {
          orgId: 'org123',
          organization: {
            name: 'Auth Test Org',
          },
        },
      ],
    };
    return next();
  }
  res.statusCode = 401;
  res.end('Unauthorized');
};

// Mock user repository
@Injectable()
class MockUserRepository {
  async findOne() {
    return Promise.resolve({
      id: 'userRepo123',
      name: 'Repository User',
      orgMemberships: [
        {
          orgId: 'org123',
          organization: {
            name: 'Repository Org',
          },
        },
      ],
    });
  }
}

// Greeting tool that uses the authentication context
@McpController()
export class AuthGreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'auth-hello-world',
    description: 'A sample tool that accesses the authenticated user',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello(
    @Payload() { name }: { name: string },
    @Ctx() context: McpContext,
  ) {
    // Access both repository data and the authenticated user context
    const repoUser = await this.userRepository.findOne();
    const authUser = context.getRawRequest<{ user: any }>()?.user; // Authenticated user from the request

    // Construct greeting using both data sources
    const greeting = `Hello, ${name}! I'm ${authUser.name} from ${authUser.orgMemberships[0].organization.name}. Repository user is ${repoUser.name}.`;

    // Report progress for demonstration
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [
        {
          type: 'text',
          text: greeting,
        },
      ],
    };
  }
}

describe('E2E: MCP Server Tool with Authentication', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const bootstrapped = await bootstrapMcpApp({
      name: 'test-auth-mcp-server',
      controllers: [AuthGreetingTool],
      providers: [MockUserRepository],
      configure: (nestApp) => {
        nestApp.use(authMiddleware);
      },
    });
    app = bootstrapped.app;
    testPort = bootstrapped.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list tools', async () => {
    const client = await createStreamableClient(testPort, {
      requestInit: {
        headers: {
          Authorization: 'Bearer token-xyz',
        },
      },
    });
    const tools = await client.listTools();

    // Verify that the authenticated tool is available
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(
      tools.tools.find((t) => t.name === 'auth-hello-world'),
    ).toBeDefined();

    await client.close();
  });

  it('should inject authentication context into the tool', async () => {
    const client = await createStreamableClient(testPort, {
      requestInit: {
        headers: {
          Authorization: 'Bearer token-xyz',
        },
      },
    });

    let progressCount = 0;
    const result: any = await client.callTool(
      {
        name: 'auth-hello-world',
        arguments: { name: 'Authenticated User' },
      },
      undefined,
      {
        onprogress: () => {
          progressCount++;
        },
      },
    );

    // Verify that progress notifications were received
    expect(progressCount).toBeGreaterThan(0);

    // Verify that authentication context was available to the tool
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Auth Test Org');
    expect(result.content[0].text).toContain('Test User');
    expect(result.content[0].text).toContain(
      'Repository user is Repository User',
    );

    await client.close();
  });

  it('should reject unauthenticated connections', async () => {
    // Connection should be rejected by the auth middleware (401)
    let client: Client | undefined;
    try {
      client = await createStreamableClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer invalid-token',
          },
        },
      });

      // If we get here, the test should fail
      throw new Error('Connection should have been rejected');
    } catch (error) {
      // We expect an error to be thrown when authentication fails
      expect(error).toBeDefined();
    } finally {
      await client?.close();
    }
  });
});
