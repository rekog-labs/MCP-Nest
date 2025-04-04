import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export async function createMCPClient(
  port: number,
  sseArgs: any = {}
): Promise<Client> {
  const client = new Client(
    { name: "example-client", version: "1.0.0" },
    { capabilities: {} }
  );
  const sseUrl = new URL(`http://localhost:${port}/sse`);
  const transport = new SSEClientTransport(sseUrl, sseArgs);
  await client.connect(transport);
  return client;
}
