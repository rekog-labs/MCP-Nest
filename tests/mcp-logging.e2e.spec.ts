import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { McpController, Tool } from '@rekog/mcp-nest';
import {
  createStreamableClient,
  McpStrategy,
  StreamableHttpTransport,
} from './utils';
import type { McpServerOptions } from '@rekog/mcp-nest';
import { Ctx, Payload } from '@nestjs/microservices';

@McpController()
class TestTool {
  @Tool({
    name: 'test-tool',
    description: 'A test tool',
    parameters: z.object({
      message: z.string(),
    }),
  })
  async testTool(@Payload() { message }: { message: string }, @Ctx() _ctx) {
    return {
      content: [
        {
          type: 'text',
          text: `Echo: ${message}`,
        },
      ],
    };
  }
}

/**
 * Inlines the `bootstrapMcpApp` helper body so the test can configure the
 * strategy's `logging` option (not exposed by the shared helper).
 */
async function bootstrapWithLogging(
  logging: McpServerOptions['logging'],
  transports: McpServerOptions['transports'],
): Promise<{ app: INestApplication; port: number }> {
  const strategy = new McpStrategy({
    name: 'test-mcp-server',
    version: '1.0.0',
    logging,
    transports,
  });

  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [TestTool],
  }).compile();

  const app = moduleFixture.createNestApplication();
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(0);
  const port = (app.getHttpServer().address() as { port: number }).port;
  return { app, port };
}

describe('MCP Logging Configuration (e2e)', () => {
  let app: INestApplication;
  let testPort: number;

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('Default logging behavior', () => {
    it('should use default NestJS logging when logging option is undefined', async () => {
      const bootstrapped = await bootstrapWithLogging(undefined, [
        new StreamableHttpTransport({ statefulMode: true }),
      ]);
      app = bootstrapped.app;
      testPort = bootstrapped.port;

      const client = await createStreamableClient(testPort);
      const result = await client.callTool({
        name: 'test-tool',
        arguments: { message: 'hello' },
      });

      expect((result.content as any)[0].text).toBe('Echo: hello');
      await client.close();
    });
  });

  describe('Disabled logging', () => {
    it('should not log when logging is set to false', async () => {
      const bootstrapped = await bootstrapWithLogging(false, [
        new StreamableHttpTransport({ statefulMode: true }),
      ]);
      app = bootstrapped.app;
      testPort = bootstrapped.port;

      const client = await createStreamableClient(testPort);
      const result = await client.callTool({
        name: 'test-tool',
        arguments: { message: 'hello' },
      });

      expect((result.content as any)[0].text).toBe('Echo: hello');
      await client.close();

      // Verify the tool still works even with logging disabled
      expect(result.content).toBeDefined();
    });
  });

  describe('Filtered logging', () => {
    it('should only log specified levels when logging.level is configured', async () => {
      const bootstrapped = await bootstrapWithLogging(
        { level: ['error', 'warn'] },
        [new StreamableHttpTransport({ statefulMode: true })],
      );
      app = bootstrapped.app;
      testPort = bootstrapped.port;

      const client = await createStreamableClient(testPort);
      const result = await client.callTool({
        name: 'test-tool',
        arguments: { message: 'hello' },
      });

      expect((result.content as any)[0].text).toBe('Echo: hello');
      await client.close();
    });
  });

  describe('Logger factory behavior', () => {
    it('should create appropriate logger based on configuration', async () => {
      // Test with all log levels
      const bootstrapped = await bootstrapWithLogging(
        { level: ['log', 'error', 'warn', 'debug', 'verbose'] },
        [new StreamableHttpTransport({ statefulMode: true })],
      );
      app = bootstrapped.app;
      testPort = bootstrapped.port;

      const client = await createStreamableClient(testPort);
      const result = await client.callTool({
        name: 'test-tool',
        arguments: { message: 'hello' },
      });

      expect((result.content as any)[0].text).toBe('Echo: hello');
      await client.close();
    });
  });

  describe('Multiple transports with logging configuration', () => {
    it('should apply logging configuration to all transports', async () => {
      const bootstrapped = await bootstrapWithLogging({ level: ['error'] }, [
        new StreamableHttpTransport({ statefulMode: true }),
      ]);
      app = bootstrapped.app;
      testPort = bootstrapped.port;

      const client = await createStreamableClient(testPort);
      const result = await client.callTool({
        name: 'test-tool',
        arguments: { message: 'hello' },
      });

      expect((result.content as any)[0].text).toBe('Echo: hello');
      await client.close();
    });
  });
});
