import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { INestApplication, Injectable, Scope } from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { z } from 'zod';
import {
  McpContext,
  McpController,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { bootstrapMcpApp, createStreamableClient } from './utils';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { randomUUID } from 'crypto';
import {
  CallToolRequest,
  CallToolResultSchema,
  ListToolsRequest,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

@Injectable()
class MockUserRepository {
  async findByName(name: string) {
    return Promise.resolve({
      id: 'user123',
      name: 'Fastify User ' + name,
      framework: 'fastify',
    });
  }
}

@McpController()
export class FastifyTestTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'fastify-hello-world',
    description: 'A test tool to verify Fastify adapter works',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello(
    @Payload() { name }: { name: string },
    @Ctx() context: McpContext,
  ) {
    // Validate that context properties exist
    if (!context.mcpServer) {
      throw new Error('mcpServer is not defined in the context');
    }
    if (!context.mcpRequest) {
      throw new Error('mcpRequest is not defined in the context');
    }

    const user = await this.userRepository.findByName(name);

    // Report progress to test streaming works
    for (let i = 0; i < 3; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await context.reportProgress({
        progress: (i + 1) * 33,
        total: 100,
      } as Progress);
    }

    return {
      content: [
        {
          type: 'text',
          text: `Hello from ${user.framework}, ${user.name}!`,
        },
      ],
    };
  }

  @Tool({
    name: 'framework-detector',
    description: 'Detects which HTTP framework is being used',
    parameters: z.object({}),
  })
  async detectFramework() {
    return {
      content: [
        {
          type: 'text',
          text: `Framework detection test - adapter working correctly`,
        },
      ],
    };
  }
}

@McpController()
@Injectable({ scope: Scope.REQUEST })
export class RequestScopedTool {
  @Tool({
    name: 'request-scope-test',
    description: 'Tests request scoping with Fastify',
    parameters: z.object({
      testId: z.string().default('test-123'),
    }),
  })
  async testRequestScope(@Payload() { testId }: { testId: string }) {
    // Generate a unique ID to verify request scoping
    const uniqueId = randomUUID();

    return {
      content: [
        {
          type: 'text',
          text: `Request-scoped response: testId=${testId}, uniqueId=${uniqueId}`,
        },
      ],
    };
  }
}

const TOOL_CONTROLLERS = [FastifyTestTool, RequestScopedTool];

describe('E2E: Fastify HTTP Adapter Support', () => {
  let expressApp: INestApplication;
  let fastifyApp: INestApplication;
  let expressPort: number;
  let fastifyPort: number;

  beforeAll(async () => {
    // Create Express-based server (control group) via the standard helper.
    const express = await bootstrapMcpApp({
      name: 'test-express-mcp-server',
      controllers: TOOL_CONTROLLERS,
      providers: [MockUserRepository],
    });
    expressApp = express.app;
    expressPort = express.port;

    // Create Fastify-based server (test subject) inline. The MCP transports use
    // an internal HttpAdapterFactory that detects Fastify and reads the raw
    // Node request/response, so streamable-HTTP works on top of Fastify.
    const strategy = new McpStrategy({
      name: 'test-fastify-mcp-server',
      version: '0.0.1',
      transports: [new StreamableHttpTransport({ statefulMode: true })],
    });

    const fastifyModuleFixture: TestingModule = await Test.createTestingModule({
      controllers: TOOL_CONTROLLERS,
      providers: [MockUserRepository],
    }).compile();

    // The Fastify body-drain bug is fixed in src: the transport prefers the
    // adapter's already-parsed body, so no in-test preHandler hook is needed.
    const fastifyAdapter = new FastifyAdapter();
    fastifyApp = fastifyModuleFixture.createNestApplication(fastifyAdapter);
    strategy.setHttpAdapter(fastifyApp.getHttpAdapter());
    fastifyApp.connectMicroservice({ strategy });
    // startAllMicroservices() runs before listen() so the MCP routes mount on
    // the Fastify instance before the HTTP server starts listening.
    await fastifyApp.startAllMicroservices();
    await fastifyApp.listen(0, '0.0.0.0');

    // On Fastify, getHttpServer().address() may be null; derive the port from
    // the underlying Node server instance instead.
    const fastifyServer = fastifyApp
      .getHttpAdapter()
      .getInstance().server;
    fastifyPort = (fastifyServer.address() as import('net').AddressInfo).port;
  });

  afterAll(async () => {
    if (expressApp) {
      await expressApp.close();
    }
    if (fastifyApp) {
      await fastifyApp.close();
    }
  });

  describe('Express Server (Control)', () => {
    let client: Client;

    beforeEach(async () => {
      if (!expressPort) {
        throw new Error('Express server not available');
      }
      client = await createStreamableClient(expressPort);
    });

    afterEach(async () => {
      if (client) {
        await client.close();
      }
    });

    it('should connect and list tools', async () => {
      const toolsRequest: ListToolsRequest = {
        method: 'tools/list',
        params: {},
      };
      const toolsResult = await client.request(
        toolsRequest,
        ListToolsResultSchema,
      );

      expect(toolsResult.tools).toBeDefined();
      expect(toolsResult.tools.length).toBeGreaterThan(0);

      const toolNames = toolsResult.tools.map((tool) => tool.name);
      expect(toolNames).toContain('fastify-hello-world');
      expect(toolNames).toContain('framework-detector');
      expect(toolNames).toContain('request-scope-test');
    });

    it('should execute tools with Express', async () => {
      const greetRequest: CallToolRequest = {
        method: 'tools/call',
        params: {
          name: 'fastify-hello-world',
          arguments: { name: 'Express Test' },
        },
      };

      const result = await client.request(greetRequest, CallToolResultSchema);
      expect(result.content).toBeDefined();
      expect(result.content[0]).toHaveProperty('text');
      expect((result.content[0] as any).text).toContain(
        'Hello from fastify, Fastify User Express Test!',
      );
    });

    it('should detect Express framework', async () => {
      const detectRequest: CallToolRequest = {
        method: 'tools/call',
        params: {
          name: 'framework-detector',
          arguments: {},
        },
      };

      const result = await client.request(detectRequest, CallToolResultSchema);
      expect(result.content).toBeDefined();
      expect(result.content[0]).toHaveProperty('text');
      expect((result.content[0] as any).text).toContain(
        'adapter working correctly',
      );
    });
  });

  describe('Fastify Server (Test Subject)', () => {
    let client: Client;

    beforeEach(async () => {
      if (!fastifyPort) {
        throw new Error('Fastify server not available');
      }
      client = await createStreamableClient(fastifyPort);
    });

    afterEach(async () => {
      if (client) {
        await client.close();
      }
    });

    it('should connect and list tools with Fastify', async () => {
      const toolsRequest: ListToolsRequest = {
        method: 'tools/list',
        params: {},
      };
      const toolsResult = await client.request(
        toolsRequest,
        ListToolsResultSchema,
      );

      expect(toolsResult.tools).toBeDefined();
      expect(toolsResult.tools.length).toBeGreaterThan(0);

      const toolNames = toolsResult.tools.map((tool) => tool.name);
      expect(toolNames).toContain('fastify-hello-world');
      expect(toolNames).toContain('framework-detector');
      expect(toolNames).toContain('request-scope-test');
    });

    it('should execute tools with Fastify adapter', async () => {
      const greetRequest: CallToolRequest = {
        method: 'tools/call',
        params: {
          name: 'fastify-hello-world',
          arguments: { name: 'Fastify Test' },
        },
      };

      let progressReports = 0;
      const result = await client.request(greetRequest, CallToolResultSchema, {
        onprogress: (progress) => {
          progressReports++;
          expect(progress.progress).toBeGreaterThan(0);
          expect(progress.total).toBe(100);
        },
      });

      expect(result.content).toBeDefined();
      expect(result.content[0]).toHaveProperty('text');
      expect((result.content[0] as any).text).toContain(
        'Hello from fastify, Fastify User Fastify Test!',
      );
      expect(progressReports).toBeGreaterThan(0); // Verify progress reporting works
    });

    it('should detect Fastify framework', async () => {
      const detectRequest: CallToolRequest = {
        method: 'tools/call',
        params: {
          name: 'framework-detector',
          arguments: {},
        },
      };

      const result = await client.request(detectRequest, CallToolResultSchema);
      expect(result.content).toBeDefined();
      expect(result.content[0]).toHaveProperty('text');
      expect((result.content[0] as any).text).toContain(
        'adapter working correctly',
      );
    });

    it('should handle request scoping correctly', async () => {
      const testId1 = 'test-1';
      const testId2 = 'test-2';

      // Make two requests with different test IDs
      const [result1, result2] = await Promise.all([
        client.request(
          {
            method: 'tools/call',
            params: {
              name: 'request-scope-test',
              arguments: { testId: testId1 },
            },
          },
          CallToolResultSchema,
        ),
        client.request(
          {
            method: 'tools/call',
            params: {
              name: 'request-scope-test',
              arguments: { testId: testId2 },
            },
          },
          CallToolResultSchema,
        ),
      ]);

      expect(result1.content[0]).toHaveProperty('text');
      expect((result1.content[0] as any).text).toContain(`testId=${testId1}`);
      expect(result2.content[0]).toHaveProperty('text');
      expect((result2.content[0] as any).text).toContain(`testId=${testId2}`);

      // Extract unique IDs to verify they're different (proper request scoping)
      const text1 = (result1.content[0] as any).text as string;
      const text2 = (result2.content[0] as any).text as string;
      const uniqueId1 = text1.match(/uniqueId=([^,\s]+)/)?.[1];
      const uniqueId2 = text2.match(/uniqueId=([^,\s]+)/)?.[1];

      expect(uniqueId1).toBeDefined();
      expect(uniqueId2).toBeDefined();
      expect(uniqueId1).not.toBe(uniqueId2); // Different requests should have different UUIDs
    });

    it('should handle errors gracefully', async () => {
      const invalidRequest: CallToolRequest = {
        method: 'tools/call',
        params: {
          name: 'non-existent-tool',
          arguments: {},
        },
      };

      await expect(
        client.request(invalidRequest, CallToolResultSchema),
      ).rejects.toThrow();
    });
  });

  describe('Framework Compatibility', () => {
    it('should produce identical tool results regardless of framework', async () => {
      const expressClient = await createStreamableClient(expressPort);
      const fastifyClient = await createStreamableClient(fastifyPort);

      try {
        // Test the same tool on both frameworks
        const testArgs = { name: 'Compatibility Test' };

        const [expressResult, fastifyResult] = await Promise.all([
          expressClient.request(
            {
              method: 'tools/call',
              params: {
                name: 'fastify-hello-world',
                arguments: testArgs,
              },
            },
            CallToolResultSchema,
          ),
          fastifyClient.request(
            {
              method: 'tools/call',
              params: {
                name: 'fastify-hello-world',
                arguments: testArgs,
              },
            },
            CallToolResultSchema,
          ),
        ]);

        // Both should return the same type of response structure
        expect(expressResult.content).toBeDefined();
        expect(fastifyResult.content).toBeDefined();
        expect(expressResult.content.length).toBe(fastifyResult.content.length);

        // Both should contain the expected content
        expect(expressResult.content[0]).toHaveProperty('text');
        expect((expressResult.content[0] as any).text).toContain(
          'Compatibility Test',
        );
        expect(fastifyResult.content[0]).toHaveProperty('text');
        expect((fastifyResult.content[0] as any).text).toContain(
          'Compatibility Test',
        );
      } finally {
        await expressClient.close();
        await fastifyClient.close();
      }
    });

    it('should list identical tools on both frameworks', async () => {
      const expressClient = await createStreamableClient(expressPort);
      const fastifyClient = await createStreamableClient(fastifyPort);

      try {
        const [expressTools, fastifyTools] = await Promise.all([
          expressClient.request(
            {
              method: 'tools/list',
              params: {},
            },
            ListToolsResultSchema,
          ),
          fastifyClient.request(
            {
              method: 'tools/list',
              params: {},
            },
            ListToolsResultSchema,
          ),
        ]);

        // Both should have the same tools available
        expect(expressTools.tools.length).toBe(fastifyTools.tools.length);

        const expressToolNames = expressTools.tools.map((t) => t.name).sort();
        const fastifyToolNames = fastifyTools.tools.map((t) => t.name).sort();

        expect(expressToolNames).toEqual(fastifyToolNames);
      } finally {
        await expressClient.close();
        await fastifyClient.close();
      }
    });
  });
});
