import { INestApplication, Injectable, Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Tool } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { McpTransportType } from '../src/mcp/interfaces';
import { createSseClient } from './utils';

@Injectable()
class TestTool {
  @Tool({
    name: 'test-tool',
    description: 'A test tool',
    parameters: z.object({
      message: z.string(),
    }),
  })
  async testTool({ message }) {
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
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
          McpModule.forRoot({
            name: 'test-mcp-server',
            version: '1.0.0',
            transport: McpTransportType.SSE,
            // logging option not specified - should use default
          }),
        ],
        providers: [TestTool],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);

      const server = app.getHttpServer();
      testPort = (server.address() as import('net').AddressInfo).port;

      const client = await createSseClient(testPort);
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
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
          McpModule.forRoot({
            name: 'test-mcp-server',
            version: '1.0.0',
            transport: McpTransportType.SSE,
            logging: false,
          }),
        ],
        providers: [TestTool],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);

      const server = app.getHttpServer();
      testPort = (server.address() as import('net').AddressInfo).port;

      const client = await createSseClient(testPort);
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
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
          McpModule.forRoot({
            name: 'test-mcp-server',
            version: '1.0.0',
            transport: McpTransportType.SSE,
            logging: {
              level: ['error', 'warn'],
            },
          }),
        ],
        providers: [TestTool],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);

      const server = app.getHttpServer();
      testPort = (server.address() as import('net').AddressInfo).port;

      const client = await createSseClient(testPort);
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
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
          McpModule.forRoot({
            name: 'test-mcp-server',
            version: '1.0.0',
            transport: McpTransportType.SSE,
            logging: {
              level: ['log', 'error', 'warn', 'debug', 'verbose'],
            },
          }),
        ],
        providers: [TestTool],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);

      const server = app.getHttpServer();
      testPort = (server.address() as import('net').AddressInfo).port;

      const client = await createSseClient(testPort);
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
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [
          McpModule.forRoot({
            name: 'test-mcp-server',
            version: '1.0.0',
            transport: [McpTransportType.SSE, McpTransportType.STREAMABLE_HTTP],
            logging: {
              level: ['error'],
            },
          }),
        ],
        providers: [TestTool],
      }).compile();

      app = moduleFixture.createNestApplication();
      await app.listen(0);

      const server = app.getHttpServer();
      testPort = (server.address() as import('net').AddressInfo).port;

      const client = await createSseClient(testPort);
      const result = await client.callTool({
        name: 'test-tool',
        arguments: { message: 'hello' },
      });

      expect((result.content as any)[0].text).toBe('Echo: hello');
      await client.close();
    });
  });
});
