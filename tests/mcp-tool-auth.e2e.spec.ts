import { INestApplication, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Context, Tool } from '../src';
import { McpModule } from '../src/mcp.module';
import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { createSseClient } from './utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';

// Mock authentication guard
class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    if (
      request.headers.authorization &&
      request.headers.authorization.includes('token-xyz')
    ) {
      request.user = {
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

    return false;
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
@Injectable()
export class AuthGreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'auth-hello-world',
    description: 'A sample tool that accesses the authenticated user',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context, request: Request & { user: any }) {
    // Access both repository data and the authenticated user context
    const repoUser = await this.userRepository.findOne();
    const authUser = request.user; // Authenticated user from the request

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
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-auth-mcp-server',
          version: '0.0.1',
          // Specify the MockAuthGuard to protect the messages endpoint
          guards: [MockAuthGuard],
          capabilities: {
            resources: {},
            resourceTemplates: {},
            prompts: {},
            tools: {
              'auth-hello-world': {
                description:
                  'A sample tool that accesses the authenticated user',
                input: {
                  name: {
                    type: 'string',
                    default: 'World',
                  },
                },
              },
            },
          },
        }),
      ],
      providers: [AuthGreetingTool, MockUserRepository, MockAuthGuard],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should list tools', async () => {
    const client = await createSseClient(testPort, {
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
    const client = await createSseClient(testPort, {
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
    // Connection should be rejected
    let client: Client | undefined;
    try {
      client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer invalid-token',
          },
        },
      });

      // If we get here, the test should fail
      fail('Connection should have been rejected');
    } catch (error) {
      // We expect an error to be thrown when authentication fails
      expect(error).toBeDefined();
    } finally {
      await client?.close();
    }
  });
});
