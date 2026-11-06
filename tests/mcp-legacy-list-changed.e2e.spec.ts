/**
 * `notifications/{tools,resources,prompts}/list_changed` on the 2025-era
 * protocol, when capabilities are (un)registered at runtime through
 * `McpStrategy.registerTool/removeTool` and friends.
 *
 * The 2025-era delivery model is unsolicited: the server pushes the
 * notification down a live channel — the standalone `GET` SSE stream of a
 * stateful Streamable HTTP session, or the stdio pipe. The modern-era
 * counterpart (`subscriptions/listen`) lives in `mcp-modern-era.e2e.spec.ts`.
 */
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import {
  Client,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { z } from 'zod';
import {
  McpController,
  McpStrategy,
  Prompt,
  Resource,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';
import { bootstrapMcpApp, createStreamableClient } from './utils';

type ListKind = 'tools' | 'resources' | 'prompts';

/** How long to wait for a notification before declaring it missing. */
const ARRIVAL_TIMEOUT_MS = 3000;
/** How long to listen before concluding a notification did NOT arrive. */
const SILENCE_WINDOW_MS = 300;

// Static capabilities so every list is advertised with `listChanged: true`
// from the moment a session initializes.
@McpController()
class StaticCapabilities {
  @Tool({ name: 'static-tool', description: 'Always there' })
  staticTool() {
    return { content: [{ type: 'text', text: 'static' }] };
  }

  @Resource({
    name: 'static-resource',
    description: 'Always there',
    uri: 'mcp://static-resource',
    mimeType: 'text/plain',
  })
  staticResource(@Payload() { uri }: { uri: string }) {
    return { contents: [{ uri, mimeType: 'text/plain', text: 'static' }] };
  }

  @Prompt({ name: 'static-prompt', description: 'Always there' })
  staticPrompt() {
    return {
      messages: [
        { role: 'user', content: { type: 'text', text: 'static prompt' } },
      ],
    };
  }
}

/**
 * Records the list_changed notifications a client receives and lets a test
 * wait for the next one of a kind (or assert that none arrives).
 */
function trackListChanged(client: Client) {
  const counts: Record<ListKind, number> = { tools: 0, resources: 0, prompts: 0 };
  const waiters: Record<ListKind, Array<() => void>> = {
    tools: [],
    resources: [],
    prompts: [],
  };
  const onArrival = (kind: ListKind) => () => {
    counts[kind]++;
    for (const resolve of waiters[kind].splice(0)) resolve();
  };
  client.setNotificationHandler(
    'notifications/tools/list_changed',
    onArrival('tools'),
  );
  client.setNotificationHandler(
    'notifications/resources/list_changed',
    onArrival('resources'),
  );
  client.setNotificationHandler(
    'notifications/prompts/list_changed',
    onArrival('prompts'),
  );

  return {
    counts,
    /** Resolves on the next arrival of `kind`; rejects after a timeout. */
    next(kind: ListKind): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no ${kind}/list_changed arrived`)),
          ARRIVAL_TIMEOUT_MS,
        );
        waiters[kind].push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

/**
 * A legacy-era client whose standalone `GET` SSE stream is known to be open.
 *
 * The SDK client opens that stream on its own after `notifications/initialized`
 * — asynchronously, after `connect()` has already resolved — and the server
 * transport drops a notification sent while no stream is attached. The server
 * registers the stream before writing its response headers, so a `fetch` that
 * has resolved with a `200 text/event-stream` to a `GET` is the exact signal
 * that a notification sent from now on will be delivered.
 */
async function connectListeningClient(port: number) {
  let streamOpened!: () => void;
  const standaloneStreamOpen = new Promise<void>((resolve) => {
    streamOpened = resolve;
  });
  const fetchWithProbe: typeof fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const response = await fetch(input, init);
    if (
      (init?.method ?? 'GET').toUpperCase() === 'GET' &&
      response.ok &&
      response.headers.get('content-type')?.includes('text/event-stream')
    ) {
      streamOpened();
    }
    return response;
  }) as typeof fetch;

  const client = new Client(
    { name: 'legacy-list-changed-client', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${port}/mcp`),
    { fetch: fetchWithProbe },
  );
  const notifications = trackListChanged(client);
  await client.connect(transport);
  await standaloneStreamOpen;
  return { client, transport, notifications };
}

function silence(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SILENCE_WINDOW_MS));
}

describe('legacy era — list_changed over stateful Streamable HTTP', () => {
  let app: INestApplication;
  let port: number;
  let strategy: McpStrategy;
  let httpTransport: StreamableHttpTransport;

  beforeAll(async () => {
    httpTransport = new StreamableHttpTransport({ statefulMode: true });
    ({ app, port, strategy } = await bootstrapMcpApp({
      controllers: [StaticCapabilities],
      transports: [httpTransport],
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends tools/list_changed when a tool is registered, and again when it is removed', async () => {
    const { client, notifications } = await connectListeningClient(port);

    const registered = notifications.next('tools');
    strategy.registerTool({
      name: 'late-tool',
      description: 'Registered after the session opened',
      parameters: z.object({}),
      handler: () => ({ content: [{ type: 'text', text: 'late' }] }),
    });
    await registered;
    const afterRegister = await client.listTools();
    expect(afterRegister.tools.map((t) => t.name)).toContain('late-tool');

    const removed = notifications.next('tools');
    strategy.removeTool('late-tool');
    await removed;
    const afterRemove = await client.listTools();
    expect(afterRemove.tools.map((t) => t.name)).not.toContain('late-tool');

    // Only the matching kind fired.
    expect(notifications.counts).toEqual({ tools: 2, resources: 0, prompts: 0 });
    await client.close();
  }, 20000);

  it('sends resources/list_changed on runtime register and remove', async () => {
    const { client, notifications } = await connectListeningClient(port);

    const registered = notifications.next('resources');
    strategy.registerResource({
      uri: 'mcp://late-resource',
      name: 'late-resource',
      mimeType: 'text/plain',
      handler: (args: { uri: string }) => ({
        contents: [{ uri: args.uri, mimeType: 'text/plain', text: 'late' }],
      }),
    });
    await registered;

    const removed = notifications.next('resources');
    strategy.removeResource('mcp://late-resource');
    await removed;

    expect(notifications.counts).toEqual({ tools: 0, resources: 2, prompts: 0 });
    await client.close();
  }, 20000);

  it('sends prompts/list_changed on runtime register and remove', async () => {
    const { client, notifications } = await connectListeningClient(port);

    const registered = notifications.next('prompts');
    strategy.registerPrompt({
      name: 'late-prompt',
      description: 'Registered after the session opened',
      handler: () => ({
        messages: [{ role: 'user', content: { type: 'text', text: 'late' } }],
      }),
    });
    await registered;

    const removed = notifications.next('prompts');
    strategy.removePrompt('late-prompt');
    await removed;

    expect(notifications.counts).toEqual({ tools: 0, resources: 0, prompts: 2 });
    await client.close();
  }, 20000);

  it('notifies every open session', async () => {
    const a = await connectListeningClient(port);
    const b = await connectListeningClient(port);

    const both = Promise.all([a.notifications.next('tools'), b.notifications.next('tools')]);
    strategy.registerTool({
      name: 'broadcast-tool',
      description: 'Seen by every session',
      handler: () => ({ content: [{ type: 'text', text: 'x' }] }),
    });
    await both;

    strategy.removeTool('broadcast-tool');
    await a.client.close();
    await b.client.close();
  }, 20000);

  it('skips terminated sessions and keeps delivering to the rest', async () => {
    const gone = await connectListeningClient(port);
    const live = await connectListeningClient(port);

    // DELETE the session server-side, so the transport drops it.
    await gone.transport.terminateSession();
    await gone.client.close();

    const arrived = live.notifications.next('tools');
    expect(() =>
      strategy.registerTool({
        name: 'after-terminate',
        description: 'Registered after one session ended',
        handler: () => ({ content: [{ type: 'text', text: 'x' }] }),
      }),
    ).not.toThrow();
    await arrived;
    await silence();
    expect(gone.notifications.counts.tools).toBe(0);

    strategy.removeTool('after-terminate');
    await live.client.close();
  }, 20000);

  it('one failing session does not stop delivery to the others', async () => {
    const broken = await connectListeningClient(port);
    const healthy = await connectListeningClient(port);
    const brokenSessionId = broken.transport.sessionId!;

    // Make the broken session's send fail both ways a send can fail:
    // synchronously, and as a rejected promise.
    const servers = (httpTransport as any).servers as Record<string, any>;
    const brokenServer = servers[brokenSessionId].server;
    const original = brokenServer.sendToolListChanged;
    let calls = 0;
    brokenServer.sendToolListChanged = () => {
      calls++;
      if (calls === 1) throw new Error('boom (sync)');
      return Promise.reject(new Error('boom (async)'));
    };
    const logger = (httpTransport as any).ctx.logger;
    const originalWarn = logger.warn;
    const warnings: string[] = [];
    logger.warn = (message: string) => warnings.push(message);

    try {
      for (const name of ['first-failure', 'second-failure']) {
        const arrived = healthy.notifications.next('tools');
        expect(() =>
          strategy.registerTool({
            name,
            description: 'Registered while one session is broken',
            handler: () => ({ content: [{ type: 'text', text: 'x' }] }),
          }),
        ).not.toThrow();
        await arrived;
      }
      expect(calls).toBe(2);
      expect(healthy.notifications.counts.tools).toBe(2);
      // Both failures were reported against the broken session, not thrown.
      const failures = warnings.filter((w) => w.includes(brokenSessionId));
      expect(failures).toHaveLength(2);
      expect(failures[0]).toContain('boom (sync)');
      expect(failures[1]).toContain('boom (async)');
    } finally {
      logger.warn = originalWarn;
      brokenServer.sendToolListChanged = original;
      strategy.removeTool('first-failure');
      strategy.removeTool('second-failure');
      await broken.client.close();
      await healthy.client.close();
    }
  }, 20000);
});

describe('legacy era — list_changed for a list declared with listChanged: false', () => {
  let app: INestApplication;
  let port: number;
  let strategy: McpStrategy;

  beforeAll(async () => {
    ({ app, port, strategy } = await bootstrapMcpApp({
      controllers: [StaticCapabilities],
      // `prompts` declared with `listChanged: false`: the spec only lets a
      // server send `prompts/list_changed` after declaring that it will. (A
      // bare `{}` is not enough — the SDK's McpServer fills in `true`.)
      capabilities: { prompts: { listChanged: false } },
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends nothing for that list, does not throw, and still notifies the others', async () => {
    const { client, notifications } = await connectListeningClient(port);
    expect(client.getServerCapabilities()?.prompts?.listChanged).toBe(false);

    expect(() =>
      strategy.registerPrompt({
        name: 'undeclared',
        description: 'prompts.listChanged was not advertised to this session',
        handler: () => ({ messages: [] }),
      }),
    ).not.toThrow();

    // Tools still advertise `listChanged: true`, so they still arrive — which
    // also proves the stream was open while the prompt change went unsent.
    const toolsArrived = notifications.next('tools');
    strategy.registerTool({
      name: 'still-announced',
      description: 'tools.listChanged is advertised',
      handler: () => ({ content: [{ type: 'text', text: 'x' }] }),
    });
    await toolsArrived;
    await silence();
    expect(notifications.counts.prompts).toBe(0);

    strategy.removePrompt('undeclared');
    strategy.removeTool('still-announced');
    await client.close();
  }, 20000);
});

describe('legacy era — stateless Streamable HTTP', () => {
  let app: INestApplication;
  let port: number;
  let strategy: McpStrategy;

  beforeAll(async () => {
    ({ app, port, strategy } = await bootstrapMcpApp({
      controllers: [StaticCapabilities],
      transports: [new StreamableHttpTransport({ statefulMode: false })],
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('has no stream to notify on: registration does not throw and the next list sees it', async () => {
    const client = await createStreamableClient(port);

    expect(() => {
      strategy.registerTool({
        name: 'stateless-late-tool',
        description: 'Registered at runtime on a stateless server',
        handler: () => ({ content: [{ type: 'text', text: 'x' }] }),
      });
      strategy.registerResource({
        uri: 'mcp://stateless-late',
        handler: () => ({ contents: [] }),
      });
      strategy.registerPrompt({
        name: 'stateless-late-prompt',
        description: 'Registered at runtime on a stateless server',
        handler: () => ({ messages: [] }),
      });
    }).not.toThrow();

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('stateless-late-tool');

    expect(() => {
      strategy.removeTool('stateless-late-tool');
      strategy.removeResource('mcp://stateless-late');
      strategy.removePrompt('stateless-late-prompt');
    }).not.toThrow();
    await client.close();
  }, 20000);
});

describe('list_changed over stdio', () => {
  const SERVER = join(__dirname, 'fixtures', 'stdio-dynamic-server.ts');
  function stdioTransport(): StdioClientTransport {
    const isBun = !!process.versions.bun;
    return new StdioClientTransport({
      command: isBun ? 'bun' : 'ts-node-dev',
      args: isBun ? ['run', SERVER] : ['--respawn', SERVER],
    });
  }

  it('legacy era: sends tools/list_changed down the pipe on register and remove', async () => {
    const client = new Client(
      { name: 'legacy-stdio-client', version: '1.0.0' },
      { capabilities: {} },
    );
    const notifications = trackListChanged(client);
    await client.connect(stdioTransport());

    const registered = notifications.next('tools');
    await client.callTool({ name: 'add-tool', arguments: { name: 'piped' } });
    await registered;
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('piped');

    const removed = notifications.next('tools');
    await client.callTool({ name: 'remove-tool', arguments: { name: 'piped' } });
    await removed;

    expect(notifications.counts.tools).toBe(2);
    await client.close();
  }, 30000);

  it('modern era: delivers tools/list_changed on a subscriptions/listen stream', async () => {
    const client = new Client(
      { name: 'modern-stdio-client', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const notifications = trackListChanged(client);
    await client.connect(stdioTransport());
    const subscription = await client.listen({ toolsListChanged: true });

    const registered = notifications.next('tools');
    await client.callTool({ name: 'add-tool', arguments: { name: 'listened' } });
    await registered;
    expect(notifications.counts.tools).toBe(1);

    await subscription.close();
    await client.close();
  }, 30000);
});
