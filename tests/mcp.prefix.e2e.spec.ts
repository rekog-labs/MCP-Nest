import { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import { McpController, Tool } from '@rekog/mcp-nest';
import {
  bootstrapMcpApp,
  StreamableHttpTransport,
  createEraClient,
  ERAS,
} from './utils';

@McpController()
class Tools {
  @Tool({
    name: 'tool',
    description: 'Tool from Module',
    parameters: z.object({}),
  })
  toolA() {
    return { content: [{ type: 'text', text: 'Tool result' }] };
  }
}

// MCP routes are mounted directly on the HTTP adapter, bypassing Nest's router
// and `setGlobalPrefix`/`apiPrefix`. To serve MCP under a prefixed path, set the
// transport endpoint explicitly.
const streamableEndpoint = '/api/mcp';

describe.each(ERAS)('MCP under a prefixed endpoint (e2e) (%s era)', (era) => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const bootstrap = await bootstrapMcpApp({
      name: 'prefix-mcp-server',
      controllers: [Tools],
      transports: [
        new StreamableHttpTransport({
          endpoint: streamableEndpoint,
          statefulMode: true,
        }),
      ],
    });
    app = bootstrap.app;
    port = bootstrap.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reach MCP over streamable-http under the prefixed endpoint', async () => {
    const client = await createEraClient(era, port, {
      endpoint: streamableEndpoint,
    });
    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(1);
      expect(tools.tools[0].name).toBe('tool');
    } finally {
      await client.close();
    }
  });

  it('should return 404 at the default (unprefixed) endpoint', async () => {
    // Nothing is mounted here, so connecting fails in BOTH eras — they just
    // surface it differently: the legacy client 404s on its `initialize` POST,
    // while the modern client reports its pinned `server/discover` probe as
    // unanswered. Asserting per era keeps both messages pinned down.
    await expect(
      createEraClient(era, port, { endpoint: '/mcp' }),
    ).rejects.toThrow(era === 'legacy' ? /404/ : /Version negotiation failed/);
  });
});

// The old suite served MCP under a global prefix *and* a module-level
// `apiPrefix` (e.g. `/api/service/custom/mcp`). Both options are gone; the
// equivalent is simply a deeper endpoint path, which works the same way.
const nestedEndpoint = '/api/service/custom/mcp';

describe.each(ERAS)('MCP under a deeply-nested endpoint (e2e) (%s era)', (era) => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const bootstrap = await bootstrapMcpApp({
      name: 'prefix-mcp-server',
      controllers: [Tools],
      transports: [
        new StreamableHttpTransport({
          endpoint: nestedEndpoint,
          statefulMode: true,
        }),
      ],
    });
    app = bootstrap.app;
    port = bootstrap.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reach MCP under the deeply-nested endpoint', async () => {
    const client = await createEraClient(era, port, {
      endpoint: nestedEndpoint,
    });
    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(1);
      expect(tools.tools[0].name).toBe('tool');
    } finally {
      await client.close();
    }
  });

  it('should return 404 at a shallower path', async () => {
    // See the note above: same rejection, era-specific message.
    await expect(
      createEraClient(era, port, { endpoint: '/api/mcp' }),
    ).rejects.toThrow(era === 'legacy' ? /404/ : /Version negotiation failed/);
  });
});
