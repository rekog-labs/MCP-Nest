import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

/**
 * Creates and connects a new MCP (Model Context Protocol) client for testing
 *
 * @param port - The port number to connect to on localhost
 * @param sseArgs - Optional configuration for the SSE transport connection. Can include eventSourceInit and requestInit options.
 * @returns A connected MCP Client instance
 * @example
 * ```ts
 * const client = await createMCPClient(3000, {
 *   requestInit: {
 *     headers: {
 *       Authorization: 'Bearer token'
 *     }
 *   }
 * });
 * ```
 */
export async function createMCPClient(
  port: number,
  sseArgs: {
    eventSourceInit?: EventSourceInit;
    requestInit?: RequestInit;
  } = {},
): Promise<Client> {
  const client = new Client(
    { name: 'example-client', version: '1.0.0' },
    {
      capabilities: {
        tools: {},
        resources: {},
        resourceTemplates: {},
      },
    },
  );
  const sseUrl = new URL(`http://localhost:${port}/sse`);
  const transport = new SSEClientTransport(sseUrl, sseArgs);
  await client.connect(transport);
  return client;
}
