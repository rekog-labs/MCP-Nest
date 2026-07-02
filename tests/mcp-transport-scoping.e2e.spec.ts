import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessagePattern } from '@nestjs/microservices';
import { z } from 'zod';
import {
  McpController,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';

@McpController()
class MixedController {
  @Tool({
    name: 'mcp-tool',
    description: 'an mcp tool',
    parameters: z.object({}),
  })
  mcpTool() {
    return { content: [{ type: 'text', text: 'ok' }] };
  }

  @MessagePattern('plain-rpc')
  plainRpc() {
    return 'not-mcp';
  }

  @MessagePattern({ cmd: 'other' })
  otherRpc() {
    return 'also-not-mcp';
  }
}

describe('E2E: McpStrategy transport scoping', () => {
  let app: INestApplication;
  let strategy: McpStrategy;

  beforeAll(async () => {
    strategy = new McpStrategy({
      name: 'scoping-server',
      version: '0.0.1',
      transports: [new StreamableHttpTransport({ statefulMode: true })],
    });

    const moduleFixture = await Test.createTestingModule({
      controllers: [MixedController],
    }).compile();

    app = moduleFixture.createNestApplication();
    strategy.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy });
    await app.startAllMicroservices();
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  it('binds only MCP capability handlers to the strategy', () => {
    const routes = Array.from(strategy.getHandlers().keys());
    // Every bound route must be an MCP pattern.
    for (const route of routes) {
      expect(route).toContain('"mcp":');
    }
    // The MCP tool is bound.
    expect(routes.some((r) => r.includes('"mcp":"tool"'))).toBe(true);
  });

  it('prunes plain @MessagePattern handlers from the MCP transport', () => {
    const routes = Array.from(strategy.getHandlers().keys());
    expect(routes.some((r) => r.includes('plain-rpc'))).toBe(false);
    expect(routes.some((r) => r.includes('"cmd":"other"'))).toBe(false);
  });
});
