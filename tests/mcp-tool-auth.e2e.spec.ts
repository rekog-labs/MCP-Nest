import {
  CanActivate,
  Controller,
  ExecutionContext,
  INestApplication,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Ctx, Payload } from '@nestjs/microservices';
import {
  McpContext,
  McpController,
  McpHttpControllerFor,
  McpRawRequest,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { Progress, Client } from "@modelcontextprotocol/client";
import { bootstrapMcpApp, createStreamableClient } from './utils';

/**
 * AUTHENTICATION for HTTP transports is a NestJS guard on the MCP route, not
 * module-level config. The guard inspects the Authorization header, populates
 * `req.user` on success, and throws `UnauthorizedException` (401) on failure —
 * gating the MCP routes the same way the old `guards: [MockAuthGuard]` did.
 * Because the MCP endpoint is mounted as a real controller (via
 * `McpHttpControllerFor`), the guard runs on every transport request. Tools
 * read the authenticated user by injecting the request with `@McpRawRequest()`
 * and reading `req.user`.
 */
@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: unknown;
    }>();
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
      return true;
    }
    throw new UnauthorizedException('Unauthorized');
  }
}

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
    @McpRawRequest() req?: { user?: any }, // raw request; read req.user
  ) {
    // Access both repository data and the authenticated user context
    const repoUser = await this.userRepository.findOne();
    const authUser = req?.user;

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

// Mount the MCP route as a real Nest controller so the guard runs at the HTTP
// layer on every transport request (initialize, tools/list, tools/call).
const mcpTransport = new StreamableHttpTransport({ statefulMode: true });

@Controller('mcp')
@UseGuards(AuthGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

describe('E2E: MCP Server Tool with Authentication', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const bootstrapped = await bootstrapMcpApp({
      name: 'test-auth-mcp-server',
      controllers: [AuthGreetingTool, McpHttpController],
      providers: [MockUserRepository, AuthGuard],
      transports: [mcpTransport],
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
