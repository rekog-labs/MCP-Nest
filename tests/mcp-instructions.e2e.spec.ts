import { INestApplication, Logger } from '@nestjs/common';
import type { IncomingMessage } from 'http';
import {
  McpController,
  McpInstructionsContext,
  Tool,
} from '@rekog/mcp-nest';
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

const instructionsFor = ({ request }: McpInstructionsContext) =>
  (request as IncomingMessage | undefined)?.headers['x-experience'] === 'foo'
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

describe.each(ERAS)('MCP server instructions resolver context (%s era)', (era) => {
  jest.setTimeout(15000);

  it('passes the caller as per-tool authorization sees it, and the era', async () => {
    const seen: McpInstructionsContext[] = [];
    const { app, port } = await bootstrapMcpApp({
      controllers: [Tools],
      resolveUser: (req) => {
        const sub = (req as IncomingMessage).headers['x-user'];
        return typeof sub === 'string' ? { sub, roles: [sub] } : undefined;
      },
      instructions: (ctx) => {
        seen.push(ctx);
        return ctx.user?.roles?.includes('admin')
          ? 'admin instructions'
          : 'default instructions';
      },
    });
    try {
      const admin = await createEraClient(era, port, {
        requestInit: { headers: { 'x-user': 'admin' } },
      });
      const anon = await createEraClient(era, port);
      try {
        expect(admin.getInstructions()).toBe('admin instructions');
        expect(anon.getInstructions()).toBe('default instructions');
      } finally {
        await admin.close();
        await anon.close();
      }
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((c) => c.era === (era === 'modern' ? 'modern' : 'legacy'))).toBe(true);
      expect(seen.every((c) => c.transport === 'streamable-http')).toBe(true);
    } finally {
      await app.close();
    }
  });

  describe.each([
    ['throws', () => {
      throw new Error('boom');
    }],
    ['returns a promise', (() => Promise.resolve('late')) as unknown as () => string],
  ])('a resolver that %s', (_label, resolver) => {
    let errorSpy: jest.SpyInstance;
    beforeEach(() => {
      errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
    });
    afterEach(() => errorSpy.mockRestore());

    it('is logged, sends no instructions, and still serves the request', async () => {
      const { app, port } = await bootstrapMcpApp({
        controllers: [Tools],
        instructions: resolver,
      });
      const client = await createEraClient(era, port);
      try {
        expect(client.getInstructions() ?? '').toBe('');
        const result: any = await client.callTool({ name: 'ping', arguments: {} });
        expect(result.content[0].text).toContain('pong');
        expect(
          errorSpy.mock.calls.some((c) =>
            String(c[0]).includes('instructions resolver'),
          ),
        ).toBe(true);
      } finally {
        await client.close();
        await app.close();
      }
    });
  });
});

describe("instructions resolver with cacheScope: 'public' on server/discover", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Spy BEFORE bootstrap — the warning fires during startAllMicroservices().
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });
  afterEach(() => {
    warnSpy?.mockRestore();
  });

  function warned(): boolean {
    return warnSpy.mock.calls
      .map((c) => String(c[0]))
      .some((m) => m.includes("cacheHints['server/discover'].cacheScope"));
  }

  it('warns when instructions are resolved per request', async () => {
    const { app } = await bootstrapMcpApp({
      controllers: [Tools],
      instructions: instructionsFor,
      cacheHints: { 'server/discover': { cacheScope: 'public' } },
    });
    expect(warned()).toBe(true);
    await app.close();
  });

  it('stays quiet for static instructions', async () => {
    const { app } = await bootstrapMcpApp({
      controllers: [Tools],
      instructions: 'static instructions',
      cacheHints: { 'server/discover': { cacheScope: 'public' } },
    });
    expect(warned()).toBe(false);
    await app.close();
  });

  it("stays quiet for a 'private' hint", async () => {
    const { app } = await bootstrapMcpApp({
      controllers: [Tools],
      instructions: instructionsFor,
      cacheHints: { 'server/discover': { ttlMs: 30_000, cacheScope: 'private' } },
    });
    expect(warned()).toBe(false);
    await app.close();
  });
});
