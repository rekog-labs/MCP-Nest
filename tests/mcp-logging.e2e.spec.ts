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

  it('should not show debug logs when logger level is set to log', async () => {
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

    // Create spy on console methods to capture logs
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();

    // Create app with log level that excludes debug
    app = moduleFixture.createNestApplication();
    app.useLogger(['log', 'error', 'warn']);

    await app.init();

    // Get all console.log calls
    const logCalls = consoleLogSpy.mock.calls.map((call) =>
      call.join(' '),
    );
    const debugCalls = consoleDebugSpy.mock.calls.map((call) =>
      call.join(' '),
    );

    // Check that debug logs from McpRegistryService are NOT present
    const hasDebugLogs = [...logCalls, ...debugCalls].some((log) =>
      log.includes('DEBUG') && log.includes('McpRegistryService'),
    );

    expect(hasDebugLogs).toBe(false);

    consoleLogSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });

  it('should show debug logs when logger level includes debug', async () => {
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

    // Create spy on console methods to capture logs
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    const consoleDebugSpy = jest.spyOn(console, 'debug').mockImplementation();

    // Create app with debug log level
    app = moduleFixture.createNestApplication();
    app.useLogger(['log', 'error', 'warn', 'debug']);

    await app.init();

    // Get all console.log calls
    const logCalls = consoleLogSpy.mock.calls.map((call) =>
      call.join(' '),
    );
    const debugCalls = consoleDebugSpy.mock.calls.map((call) =>
      call.join(' '),
    );

    // Check that debug logs from McpRegistryService ARE present
    const hasDebugLogs = [...logCalls, ...debugCalls].some((log) =>
      log.includes('DEBUG') && log.includes('McpRegistryService'),
    );

    // Debug: print all logs
    if (!hasDebugLogs) {
      console.log('=== ALL LOGS ===');
      [...logCalls, ...debugCalls].forEach((log) => {
        if (log.includes('McpRegistry') || log.includes('DEBUG')) {
          console.log(log);
        }
      });
    }

    expect(hasDebugLogs).toBe(true);

    consoleLogSpy.mockRestore();
    consoleDebugSpy.mockRestore();
  });
});
