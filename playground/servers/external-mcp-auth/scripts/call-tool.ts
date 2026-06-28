/**
 * Minimal non-interactive MCP client for the external-auth playground.
 *
 * Connects to the resource server's `/mcp` endpoint with a Casdoor-issued
 * Bearer token (mint one with `./get-token.sh`), lists the tools, and calls
 * `greet-world`. The token is validated by `CasdoorAuthGuard` on the server.
 *
 * Usage (from the repo root):
 *   ACCESS_TOKEN=$(playground/servers/external-mcp-auth/scripts/get-token.sh) \
 *     npx ts-node-dev -r tsconfig-paths/register \
 *     playground/servers/external-mcp-auth/scripts/call-tool.ts
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PORT = Number(process.env.PORT ?? 3030);
const SERVER_URL = process.env.SERVER_URL ?? `http://localhost:${PORT}`;
const MCP_URL = `${SERVER_URL}/mcp`;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;

async function main() {
  if (!ACCESS_TOKEN) {
    console.error(
      'Missing ACCESS_TOKEN. Mint one first:\n' +
        '  ACCESS_TOKEN=$(playground/servers/external-mcp-auth/scripts/get-token.sh) \\\n' +
        '    npx ts-node-dev -r tsconfig-paths/register \\\n' +
        '    playground/servers/external-mcp-auth/scripts/call-tool.ts',
    );
    process.exit(1);
  }

  const client = new Client(
    { name: 'external-auth-client', version: '1.0.0' },
    { capabilities: {} },
  );

  // The Bearer token rides on every HTTP request the transport makes; the
  // server's CasdoorAuthGuard validates it against Casdoor's JWKS.
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } },
  });

  await client.connect(transport);
  console.log(`Connected to ${MCP_URL}`);

  const tools = await client.listTools();
  console.log('Available tools:', tools.tools.map((t) => t.name).join(', '));

  const result = (await client.callTool({
    name: 'greet-world',
    arguments: {},
  })) as { content: Array<{ text: string }> };
  console.log('greet-world result:', result.content[0].text);

  await client.close();
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
