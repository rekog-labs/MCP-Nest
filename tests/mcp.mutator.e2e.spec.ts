import { INestApplication } from '@nestjs/common';
import { McpController, Tool } from '../src';
import { bootstrapMcpApp, createStreamableClient } from './utils';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

@McpController()
class Tools {
  @Tool({
    name: 'tool',
    description: 'Tool from Module',
  })
  toolA() {
    return 'Tool result';
  }
}

let fakeTelemetry = jest.fn();

const telemetryMutator = (server: McpServer) => {
  const originalConnect = server.connect.bind(server);

  server.connect = async (transport) => {
    fakeTelemetry();
    return originalConnect(transport);
  };

  return server;
};

describe('MCP with mutated telemetry server', () => {
  let app: INestApplication;
  let port: number;

  // Set timeout for all tests in this describe block to 15000ms
  jest.setTimeout(15000);

  beforeEach(async () => {
    fakeTelemetry.mockClear();
  });

  beforeAll(async () => {
    const bootstrapped = await bootstrapMcpApp({
      name: 'mutated-mcp-server',
      version: '0.0.1',
      controllers: [Tools],
      serverMutator: telemetryMutator,
    });
    app = bootstrapped.app;
    port = bootstrapped.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should connect to mutated server', async () => {
    const client = await createStreamableClient(port, {
      endpoint: `/mcp`,
    });

    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(1);
      expect(fakeTelemetry).toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});
