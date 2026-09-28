import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, mock } from 'bun:test';

const transportClose = mock(async () => undefined);
const handleRequest = mock(async () => undefined);

mock.module('@modelcontextprotocol/node', () => ({
  NodeStreamableHTTPServerTransport: class {
    close = transportClose;
    handleRequest = handleRequest;
  },
  toNodeHandler: mock(),
}));

const { StreamableHttpTransport } = await import('./streamable-http.transport');

describe('StreamableHttpTransport', () => {
  const serverClose = mock(async () => undefined);

  beforeEach(() => {
    transportClose.mockClear();
    handleRequest.mockClear();
    serverClose.mockClear();
  });

  async function serveStateless(): Promise<EventEmitter> {
    const server = {
      connect: mock(async () => undefined),
      close: serverClose,
    };
    const rawResponse = new EventEmitter();
    const transport = new StreamableHttpTransport({ protocol: 'legacy-only' });

    (transport as any).ctx = {
      createServer: () => server,
      bindRequestHandlers: mock(),
    };

    await (transport as any).handleStateless(
      { raw: {} },
      { raw: rawResponse },
      {},
    );
    return rawResponse;
  }

  it('closes a stateless server when the response is aborted', async () => {
    const rawResponse = await serveStateless();

    // An aborted response emits 'close' without 'finish'.
    rawResponse.emit('close');

    expect(transportClose).toHaveBeenCalledTimes(1);
    expect(serverClose).toHaveBeenCalledTimes(1);
  });

  it('closes a stateless server once when the response finishes normally', async () => {
    const rawResponse = await serveStateless();

    // A completed response emits 'finish' and then 'close'.
    rawResponse.emit('finish');
    expect(transportClose).toHaveBeenCalledTimes(1);
    expect(serverClose).toHaveBeenCalledTimes(1);

    rawResponse.emit('close');
    expect(transportClose).toHaveBeenCalledTimes(1);
    expect(serverClose).toHaveBeenCalledTimes(1);
  });
});
