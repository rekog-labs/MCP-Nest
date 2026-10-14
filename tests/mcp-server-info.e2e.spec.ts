import { INestApplication, Logger } from '@nestjs/common';
import type { IncomingMessage } from 'http';
import { McpController, McpInstructionsContext, Tool } from '@rekog/mcp-nest';
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

const brandOf = ({ request }: McpInstructionsContext) =>
  (request as IncomingMessage | undefined)?.headers['x-brand'] === 'acme'
    ? 'Acme'
    : 'Default';

describe.each(ERAS)('MCP server info (%s era)', (era) => {
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
        title: (ctx) => `${brandOf(ctx)} Assistant`,
        description: (ctx) => `Ask ${brandOf(ctx)} about your fleet`,
        transports: [new StreamableHttpTransport({ statefulMode })],
      }));
    });

    afterAll(async () => {
      await app.close();
    });

    it.each([
      ['acme', 'Acme'],
      ['other', 'Default'],
    ])(
      'resolves title and description per client (x-brand: %s)',
      async (header, brand) => {
        const client = await createEraClient(era, port, {
          requestInit: { headers: { 'x-brand': header } },
        });
        try {
          expect(client.getServerVersion()).toMatchObject({
            title: `${brand} Assistant`,
            description: `Ask ${brand} about your fleet`,
          });
        } finally {
          await client.close();
        }
      },
    );
  });

  it('still accepts static strings', async () => {
    const { app, port } = await bootstrapMcpApp({
      controllers: [Tools],
      title: 'Static Assistant',
      description: 'Static description',
    });
    const client = await createEraClient(era, port);
    try {
      expect(client.getServerVersion()).toMatchObject({
        title: 'Static Assistant',
        description: 'Static description',
      });
    } finally {
      await client.close();
      await app.close();
    }
  });

  describe('a title resolver that throws', () => {
    let errorSpy: jest.SpyInstance;
    beforeEach(() => {
      errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });
    afterEach(() => errorSpy.mockRestore());

    it('is logged, sends no title, and still serves the request', async () => {
      const { app, port } = await bootstrapMcpApp({
        controllers: [Tools],
        title: () => {
          throw new Error('boom');
        },
      });
      const client = await createEraClient(era, port);
      try {
        expect(client.getServerVersion()?.title).toBeUndefined();
        const result: any = await client.callTool({
          name: 'ping',
          arguments: {},
        });
        expect(result.content[0].text).toContain('pong');
        expect(
          errorSpy.mock.calls.some((c) =>
            String(c[0]).includes('title resolver'),
          ),
        ).toBe(true);
      } finally {
        await client.close();
        await app.close();
      }
    });
  });
});

describe("server info resolver with cacheScope: 'public' on server/discover", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy?.mockRestore();
  });

  it('warns and names the per-request field', async () => {
    const { app } = await bootstrapMcpApp({
      controllers: [Tools],
      title: (ctx) => `${brandOf(ctx)} Assistant`,
      cacheHints: { 'server/discover': { cacheScope: 'public' } },
    });
    expect(
      warnSpy.mock.calls
        .map((c) => String(c[0]))
        .some(
          (m) =>
            m.includes("cacheHints['server/discover'].cacheScope") &&
            m.includes('title is resolved per request'),
        ),
    ).toBe(true);
    await app.close();
  });
});
