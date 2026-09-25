import { EventEmitter } from 'node:events';
import { describe, expect, it, mock } from 'bun:test';

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
  it('closes a stateless server when the response is aborted', async () => {
    const serverClose = mock(async () => undefined);
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

    rawResponse.emit('close');
    rawResponse.emit('finish');

    expect(transportClose).toHaveBeenCalledTimes(1);
    expect(serverClose).toHaveBeenCalledTimes(1);
  });
});
