import { INestApplication, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Tool } from '../src';
import type { Context } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { createStreamableClient } from './utils';

@Injectable()
class LoggingTool {
  @Tool({
    name: 'log-something',
    description: 'A tool that emits a server log message',
    parameters: z.object({}),
  })
  async run(_args, context: Context) {
    context.log.info('hello from server');
    return { content: [{ type: 'text', text: 'done' }] };
  }
}

describe('MCP logging capability', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'logging-cap-server',
          version: '0.0.1',
          streamableHttp: {
            enableJsonResponse: false,
            sessionIdGenerator: () => Math.random().toString(36),
            statelessMode: false,
          },
        }),
      ],
      providers: [LoggingTool],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);
    port = (app.getHttpServer().address() as import('net').AddressInfo).port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('advertises the `logging` capability', async () => {
    const client = await createStreamableClient(port);
    const caps = client.getServerCapabilities();

    // The server emits notifications/message via context.log.*, so per the MCP spec
    // it MUST declare the `logging` capability.
    expect(caps?.logging).toBeDefined();
    // sanity: tools capability is still advertised alongside it
    expect(caps?.tools).toBeDefined();

    await client.close();
  });
});
