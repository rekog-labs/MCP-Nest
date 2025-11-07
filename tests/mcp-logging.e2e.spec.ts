import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { McpModule, McpTransportType } from '../src';
import { Injectable } from '@nestjs/common';
import { Tool } from '../src';
import { z } from 'zod';

@Injectable()
class SimpleToolService {
  @Tool({
    name: 'simple-tool',
    description: 'A simple tool for testing',
    parameters: z.object({}),
  })
  async execute() {
    return {
      content: [{ type: 'text', text: 'Hello' }],
    };
  }
}

describe('E2E: MCP Logging Configuration', () => {
  let app: INestApplication;

  jest.setTimeout(15000);

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should not show debug logs when logger level excludes debug', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-mcp-server',
          version: '0.0.1',
          transport: [McpTransportType.SSE],
        }),
      ],
      providers: [SimpleToolService],
    }).compile();

    // Create app with log level that excludes debug
    app = moduleFixture.createNestApplication();
    
    // Capture console output
    const logSpy = jest.spyOn(console, 'log').mockImplementation();
    
    app.useLogger(['log', 'error', 'warn']);
    await app.init();

    // Get all console.log calls
    const logCalls = logSpy.mock.calls.map((call) => call.join(' '));

    // Check that debug logs from McpRegistryService are NOT present
    const hasDebugLogs = logCalls.some((log) =>
      log.includes('DEBUG') && log.includes('McpRegistryService'),
    );

    expect(hasDebugLogs).toBe(false);

    logSpy.mockRestore();
  });

  it('should not show any logs when logger is disabled', async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-mcp-server-no-logs',
          version: '0.0.1',
          transport: [McpTransportType.SSE],
        }),
      ],
      providers: [SimpleToolService],
    }).compile();

    // Create app with logging disabled
    app = moduleFixture.createNestApplication();

    // Capture console output
    const logSpy = jest.spyOn(console, 'log').mockImplementation();

    app.useLogger(false);
    await app.init();

    // Get all console.log calls
    const logCalls = logSpy.mock.calls.map((call) => call.join(' '));

    // Check that no Nest logs are present
    const hasNestLogs = logCalls.some((log) => log.includes('[Nest]'));

    expect(hasNestLogs).toBe(false);

    logSpy.mockRestore();
  });
});

