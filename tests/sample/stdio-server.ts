import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { Inject, Injectable, Module, Scope } from '@nestjs/common';
import { z } from 'zod';
import { Context, McpTransportType, Tool } from '../../src';
import { McpModule } from '../../src/mcp.module';
// Import createStdioClient
import { NestFactory, REQUEST } from '@nestjs/core';

// --- Existing MockUserRepository, GreetingTool, GreetingToolRequestScoped, ToolRequestScoped classes ---
// ... (Keep existing classes as they are) ...
@Injectable()
class MockUserRepository {
  async findByName(name: string) {
    return Promise.resolve({
      id: 'user123',
      name: 'Repository User Name ' + name,
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

@Injectable()
export class GreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that gets the user by name',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context) {
    const user = await this.userRepository.findByName(name);
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

  @Tool({
    name: 'hello-world-error',
    description: 'A sample tool that throws an error',
    parameters: z.object({}),
  })
  async sayHelloError() {
    throw new Error('any error');
  }
}

@Injectable({ scope: Scope.REQUEST })
export class GreetingToolRequestScoped {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world-scoped',
    description: 'A sample request-scoped tool that gets the user by name',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context) {
    const user = await this.userRepository.findByName(name);
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
export class ToolRequestScoped {
  constructor(@Inject(REQUEST) private request: Request) {}

  @Tool({
    name: 'get-request-scoped',
    description: 'A sample tool that gets a header from the request',
    parameters: z.object({}),
  })
  async getRequest() {
    // STDIO doesn't have headers, so provide a default or handle differently
    const headerValue =
      this.request?.headers?.['any-header'] ?? 'No header (stdio)';
    return {
      content: [
        {
          type: 'text',
          text: headerValue,
        },
      ],
    };
  }
}

@Injectable()
class OutputSchemaTool {
  constructor() { }
  @Tool({
    name: 'output-schema-tool',
    description: 'A tool to test outputSchema',
    parameters: z.object({
      input: z.string().describe('Example input'),
    }),
    outputSchema: z.object({
      result: z.string().describe('Example result'),
    }),
  })
  async execute({ input }) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({result: input}),
        },
      ],
    };
  }
}
// --- End of existing classes ---

// --- Create a simple module and bootstrap function for the STDIO server ---
@Module({
  imports: [
    McpModule.forRoot({
      name: 'test-mcp-stdio-server',
      version: '0.0.1',
      transport: McpTransportType.STDIO, // Use STDIO transport
      guards: [],
    }),
  ],
  providers: [
    GreetingTool,
    GreetingToolRequestScoped,
    MockUserRepository,
    ToolRequestScoped,
    OutputSchemaTool,
  ],
})
class StdioTestAppModule {}

async function bootstrapStdioServer() {
  // Use createApplicationContext for STDIO
  const app = await NestFactory.createApplicationContext(StdioTestAppModule, {
    logger: false, // Disable logger for cleaner stdio communication
  });
  // Keep the process running until closed by the client
  // For testing, we might not need an explicit close here if the client handles shutdown.
  // await app.init(); // Ensure initialization if needed, but context usually handles this.
  // No app.close() here, let the client manage the lifecycle via transport.close()
}

// Check if this script is run directly to start the STDIO server
if (require.main === module) {
  void bootstrapStdioServer();
}
