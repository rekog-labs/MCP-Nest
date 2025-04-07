import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { INestApplication, Injectable, Scope } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Context, Tool } from '../src';
import { McpModule } from '../src/mcp.module';
import { createMCPClient } from './utils';

// Mock user repository
@Injectable({ scope: Scope.TRANSIENT })
class MockUserRepository {
  async findOne(id: string) {
    return Promise.resolve({
      id,
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
export class GreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that get the user by id',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ id }, context: Context) {
    const user = await this.userRepository.findOne(id);

    // Report progress for demonstration
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${user.name}!`,
        },
      ],
    };
  }
}

@Injectable({ scope: Scope.REQUEST })
export class GreetingToolRequestScoped {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world-scoped',
    description: 'A sample tool that get the user by id',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ id }, context: Context) {
    const user = await this.userRepository.findOne(id);

    // Report progress for demonstration
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${user.name}!`,
        },
      ],
    };
  }
}

describe('E2E: MCP Server', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-mcp-server',
          version: '0.0.1',
          guards: [],
        }),
      ],
      providers: [GreetingTool, GreetingToolRequestScoped, MockUserRepository],
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
    const client = await createMCPClient(testPort);
    const tools = await client.listTools();

    // Verify that the authenticated tool is available
    expect(tools.tools.length).toBeGreaterThan(0);
    expect(tools.tools.find((t) => t.name === 'hello-world')).toBeDefined();

    await client.close();
  });

  it.each([{ tool: 'hello-world' }, { tool: 'hello-world-scoped' }])(
    'should call the tool and receive progress notifications for $tool',
    async ({ tool }) => {
      const client = await createMCPClient(testPort);

      let progressCount = 1;
      const result: any = await client.callTool(
        {
          name: tool,
          arguments: { id: 'userRepo123' },
        },
        undefined,
        {
          onprogress: () => {
            progressCount++;
          },
        },
      );

      // Verify that progress notifications were received
      expect(progressCount).toBe(5);

      // Verify that authentication context was available to the tool
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('Hello, Repository User!');

      await client.close();
    },
  );
});
