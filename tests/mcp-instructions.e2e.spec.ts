import { INestApplication } from '@nestjs/common';
import type { IncomingMessage } from 'http';
import { McpController, Tool } from '@rekog/mcp-nest';
import {
  bootstrapMcpApp,
  createEraClient,
  ERAS,
  StreamableHttpTransport,
} from './utils';

@McpController()
class Tools {
  @Tool({ name: 'ping', description: 'Ping' })
  ping() {
    return 'pong';
  }
}

const instructionsFor = (req: unknown) =>
  (req as IncomingMessage | undefined)?.headers['x-experience'] === 'foo'
    ? 'foo instructions'
    : 'default instructions';

describe.each(ERAS)('MCP server instructions (%s era)', (era) => {
  jest.setTimeout(15000);

  describe.each([
    ['stateful', true],
    ['stateless', false],
  ])('%s transport', (_mode, statefulMode) => {
    let app: INestApplication;
    let port: number;

    beforeAll(async () => {
      ({ app, port } = await bootstrapMcpApp({
        controllers: [Tools],
        instructions: instructionsFor,
        transports: [new StreamableHttpTransport({ statefulMode })],
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it.each([
      ['foo', 'foo instructions'],
      ['bar', 'default instructions'],
    ])(
      'resolves instructions per client (x-experience: %s)',
      async (header, expected) => {
        const client = await createEraClient(era, port, {
          requestInit: { headers: { 'x-experience': header } },
        });
        try {
          expect(client.getInstructions()).toBe(expected);
        } finally {
          await client.close();
        }
      },
    );
  });

  it('still accepts a static string', async () => {
    const { app, port } = await bootstrapMcpApp({
      controllers: [Tools],
      instructions: 'static instructions',
    });
    const client = await createEraClient(era, port);
    try {
      expect(client.getInstructions()).toBe('static instructions');
    } finally {
      await client.close();
      await app.close();
    }
  });
});
