import { INestApplication, Injectable } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { z } from "zod";
import { Tool, Cleanup } from "../src";
import { McpModule } from "../src/mcp.module";
import { Context } from "../src/services/mcp-tools.discovery";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Progress } from "@modelcontextprotocol/sdk/types.js";
import { CleanupContext } from "../src/services/cleanup.service";

const mockCleanupFn = jest.fn();

// Mock UserRepository for testing
@Injectable()
class MockUserRepository {
  async findOne() {
    return {
      id: "user123",
      name: "Test User",
      orgMemberships: [
        {
          orgId: "org123",
          organization: {
            name: "Test Org",
          },
        },
      ],
    };
  }

  async cleanupBySessionId(sessionId: string) {
    mockCleanupFn(sessionId);
  }
}

@Injectable()
export class GreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: "hello-world",
    description: "A sample tool that returns a greeting",
    parameters: z.object({
      name: z.string().default("World"),
    }),
  })
  async sayHello({ name }, context: Context) {
    const user = await this.userRepository.findOne();
    const greeting = `Hello, ${name}! I'm ${user.name} from ${
      user.orgMemberships[0].organization.name
    }.`;

    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await context.reportProgress({
        progress: (i+1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [
        {
          type: "text",
          text: greeting,
        },
      ],
    };
  }

  @Cleanup()
  async onSessionClose(context: CleanupContext) {
    await this.userRepository.cleanupBySessionId(context.sessionId);
  }
}

describe("E2E: MCP Server via SSE", () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: "test-mcp-server",
          version: "0.0.1",
          capabilities: {
            tools: {
              "hello-world": {
                description: "A sample tool that returns a greeting",
                input: {
                  name: {
                    type: "string",
                    default: "World",
                  },
                },
              },
              "progress-test": {
                description: "A tool that simulates progress",
              },
            },
          },
        }),
      ],
      providers: [GreetingTool, MockUserRepository],
      exports: [MockUserRepository],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => jest.clearAllMocks());

  it("should list tools", async () => {
    const client = new Client(
      { name: "example-client", version: "1.0.0" },
      { capabilities: {} },
    );
    const sseUrl = new URL(`http://localhost:${testPort}/sse`);
    const transport = new SSEClientTransport(sseUrl);
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);
    await client.close();

    // give time for cleanup promises to be resolved
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockCleanupFn).toHaveBeenCalledTimes(1);
    expect(mockCleanupFn).toHaveBeenCalledWith(expect.any(String));
  });

  it('should inject dependencies into the tool and call the "hello-world" tool via SSE', async () => {
    const client = new Client(
      { name: "example-client", version: "1.0.0" },
      { capabilities: {} },
    );
    const sseUrl = new URL(`http://localhost:${testPort}/sse`);
    const transport = new SSEClientTransport(sseUrl);
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools.find((t) => t.name == "hello-world")).toBeDefined();

    let countProgress=1;
    const result = await client.callTool(
      {
        name: "hello-world",
        arguments: { name: "World" },
      },
      undefined,
      {
        onprogress: (progress) => {
          console.log(progress);
          countProgress++;
        },
      },
    );

    expect(countProgress).toBe(5)
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Hello, World! I'm Test User from Test Org.",
        },
      ],
    });
    await client.close();

    // give time for cleanup promises to be resolved
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(mockCleanupFn).toHaveBeenCalledTimes(1);
    expect(mockCleanupFn).toHaveBeenCalledWith(expect.any(String));
  });
});
