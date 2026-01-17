import { INestApplication, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { McpModule } from '../src/mcp/mcp.module';
import { createStreamableClient } from './utils';
import { Tool } from '../src/mcp/decorators/tool.decorator';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

@Injectable()
class Tools {
  @Tool({
    name: 'tool',
    description: 'Tool from Module',
  })
  toolA() {
    return 'Tool result';
  }
}

const composeMutators = (...mutators: Array<(server: McpServer) => McpServer>) => {
  return (server: McpServer) => {
    return mutators.reduce((srv, mutator) => mutator(srv), server);
  }
}

let fakeTelemetry = jest.fn();

const telemetryMutator = (server: McpServer) => {
  const originalConnect = server.connect;

  server.connect = async (transport) => {
    fakeTelemetry();
    return originalConnect.call(server, transport);
  }

  return server;
}

describe('MCP with mutated telemetry server', () => {
  let app: INestApplication;
  let port: number;

  // Set timeout for all tests in this describe block to 15000ms
  jest.setTimeout(15000);

  beforeEach(async () => {
    fakeTelemetry.mockClear();
  })

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'mutated-mcp-server',
          version: '0.0.1',
          serverMutator: telemetryMutator,
        }),
      ],
      providers: [Tools],
      exports: [Tools],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    port = (server.address() as import('net').AddressInfo).port;
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
