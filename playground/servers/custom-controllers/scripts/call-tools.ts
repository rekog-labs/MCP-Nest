/**
 * Minimal MCP client that drives the two-layer pipeline example.
 *
 * Connects, lists tools, calls `greet` (watch the RPC interceptor tag the
 * result with ` [rpc]`), then calls `boom` (watch the RPC exception filter
 * surface the real error message as `isError: true`).
 *
 * Usage (from the repo root, with the server already running):
 *   npx ts-node-dev -r tsconfig-paths/register \
 *     playground/servers/custom-controllers/scripts/call-tools.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = Number(process.env.PORT ?? 3030);
const MCP_URL = `http://localhost:${PORT}/mcp`;

async function main() {
  const client = new Client(
    { name: 'two-layer-demo-client', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));

  await client.connect(transport);
  console.log(`Connected to ${MCP_URL}`);

  const tools = await client.listTools();
  console.log('Tools:', tools.tools.map((t) => t.name).join(', '));

  const greet = (await client.callTool({
    name: 'greet',
    arguments: { name: 'Ada' },
  })) as { content: Array<{ text: string }> };
  console.log('greet →', JSON.stringify(greet.content[0]));

  const boom = (await client.callTool({
    name: 'boom',
    arguments: {},
  })) as { isError?: boolean; content: Array<{ text: string }> };
  console.log('boom  →', JSON.stringify(boom));

  await client.close();
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
