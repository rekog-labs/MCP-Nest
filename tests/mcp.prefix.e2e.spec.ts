import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import { McpController, Tool } from '../src';
import {
  bootstrapMcpApp,
  createStreamableClient,
  SseTransport,
  StreamableHttpTransport,
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
// transport endpoints explicitly.
const streamableEndpoint = '/api/mcp';
const sseEndpoint = '/api/sse';
const messagesEndpoint = '/api/messages';

async function createPrefixedSseClient(port: number): Promise<Client> {
  const client = new Client(
    { name: 'example-client', version: '1.0.0' },
    { capabilities: {} },
  );
  const sseUrl = new URL(`http://localhost:${port}${sseEndpoint}`);
  const transport = new SSEClientTransport(sseUrl);
  await client.connect(transport);
  return client;
}

describe('MCP under a prefixed endpoint (e2e)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const bootstrap = await bootstrapMcpApp({
      name: 'prefix-mcp-server',
      controllers: [Tools],
      transports: [
        new StreamableHttpTransport({
          endpoint: streamableEndpoint,
          statelessMode: false,
        }),
        new SseTransport({ sseEndpoint, messagesEndpoint }),
      ],
    });
    app = bootstrap.app;
    port = bootstrap.port;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should reach MCP over streamable-http under the prefixed endpoint', async () => {
    const client = await createStreamableClient(port, {
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

  it('should reach MCP over SSE under the prefixed endpoint', async () => {
    const client = await createPrefixedSseClient(port);
    try {
      const tools = await client.listTools();
      expect(tools.tools.length).toBe(1);
      expect(tools.tools[0].name).toBe('tool');
    } finally {
      await client.close();
    }
  });

  it('should not be reachable at the default (unprefixed) endpoint', async () => {
    await expect(
      createStreamableClient(port, { endpoint: '/mcp' }),
    ).rejects.toThrow();
  });
});

// The old suite served MCP under a global prefix *and* a module-level
// `apiPrefix` (e.g. `/api/service/custom/mcp`). Both options are gone; the
// equivalent is simply a deeper endpoint path, which works the same way.
const nestedEndpoint = '/api/service/custom/mcp';

describe('MCP under a deeply-nested endpoint (e2e)', () => {
  let app: INestApplication;
  let port: number;

  beforeAll(async () => {
    const bootstrap = await bootstrapMcpApp({
      name: 'prefix-mcp-server',
      controllers: [Tools],
      transports: [
        new StreamableHttpTransport({
          endpoint: nestedEndpoint,
          statelessMode: false,
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
    const client = await createStreamableClient(port, {
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

  it('should not be reachable at a shallower path', async () => {
    await expect(
      createStreamableClient(port, { endpoint: '/api/mcp' }),
    ).rejects.toThrow();
  });
});
