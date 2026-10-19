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

  describe.each(['title', 'description'] as const)(
    'a %s resolver that throws',
    (field) => {
      let errorSpy: jest.SpyInstance;
      beforeEach(() => {
        errorSpy = jest
          .spyOn(Logger.prototype, 'error')
          .mockImplementation(() => undefined);
      });
      afterEach(() => errorSpy.mockRestore());

      it(`is logged, sends no ${field}, and still serves the request`, async () => {
        const { app, port } = await bootstrapMcpApp({
          controllers: [Tools],
          [field]: () => {
            throw new Error('boom');
          },
        });
        const client = await createEraClient(era, port);
        try {
          expect(client.getServerVersion()?.[field]).toBeUndefined();
          const result: any = await client.callTool({
            name: 'ping',
            arguments: {},
          });
          expect(result.content[0].text).toContain('pong');
          expect(
            errorSpy.mock.calls.some((c) =>
              String(c[0]).includes(`${field} resolver`),
            ),
          ).toBe(true);
        } finally {
          await client.close();
          await app.close();
        }
      });
    },
  );
});

describe("server info resolver with a cacheScope: 'public' hint", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy?.mockRestore();
  });

  function serverInfoWarning(): string | undefined {
    return warnSpy.mock.calls
      .map((c) => String(c[0]))
      .find((m) => m.includes('resolved per request. Every 2026-07-28 result'));
  }

  it.each(['server/discover', 'tools/list'] as const)(
    'warns on a public %s hint and names the method and the field',
    async (method) => {
      const { app } = await bootstrapMcpApp({
        controllers: [Tools],
        title: (ctx) => `${brandOf(ctx)} Assistant`,
        cacheHints: { [method]: { cacheScope: 'public' } },
      });
      expect(serverInfoWarning()).toContain(`cacheHints for ${method} has`);
      expect(serverInfoWarning()).toContain('but title is resolved');
      await app.close();
    },
  );

  it('names every public method and every per-request field', async () => {
    const { app } = await bootstrapMcpApp({
      controllers: [Tools],
      title: (ctx) => `${brandOf(ctx)} Assistant`,
      description: (ctx) => `Ask ${brandOf(ctx)} about your fleet`,
      cacheHints: {
        'tools/list': { cacheScope: 'public' },
        'prompts/list': { cacheScope: 'public' },
        'resources/read': { cacheScope: 'private' },
      },
    });
    expect(serverInfoWarning()).toContain(
      'cacheHints for tools/list, prompts/list have',
    );
    expect(serverInfoWarning()).toContain(
      'but title and description are resolved',
    );
    await app.close();
  });

  it('stays quiet for a static title or private hints', async () => {
    const staticTitle = await bootstrapMcpApp({
      controllers: [Tools],
      title: 'Static Assistant',
      cacheHints: { 'tools/list': { cacheScope: 'public' } },
    });
    await staticTitle.app.close();
    const privateHint = await bootstrapMcpApp({
      controllers: [Tools],
      title: (ctx) => `${brandOf(ctx)} Assistant`,
      cacheHints: { 'tools/list': { ttlMs: 30_000, cacheScope: 'private' } },
    });
    await privateHint.app.close();
    expect(serverInfoWarning()).toBeUndefined();
  });
});
