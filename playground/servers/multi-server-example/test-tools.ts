/**
 * Test script to verify tools are reachable on each server endpoint.
 * Run with: npx ts-node playground/servers/multi-server-example/test-tools.ts
 *
 * NOTE: With the strategy model, every @McpController binds to every connected
 * strategy, so BOTH servers expose the same shared tool set. This script verifies
 * each server endpoint is reachable and advertises that shared set.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const SERVER_URL = 'http://localhost:3000';

// All servers expose the same tools (shared @McpControllers).
const EXPECTED_TOOLS = [
  'get-weather',
  'list-cities',
  'get-metrics',
  'track-request',
  'send-notification',
  'get-notifications',
  'mark-notification-read',
];

async function testServer(serverName: string, mcpEndpoint: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${serverName}`);
  console.log('='.repeat(60));

  // Connect over the Streamable HTTP transport at the server's /mcp endpoint.
  const transport = new StreamableHTTPClientTransport(
    new URL(mcpEndpoint, SERVER_URL),
  );

  const client = new Client(
    {
      name: 'test-client',
      version: '1.0.0',
    },
    {
      capabilities: {},
    },
  );

  await client.connect(transport);

  try {
    // List all tools
    const { tools } = await client.listTools();

    console.log(`\nFound ${tools.length} tools:`);
    tools.forEach((tool) => {
      console.log(`  ✓ ${tool.name} - ${tool.description}`);
    });

    // Verify expected tools
    const toolNames = tools.map((t) => t.name);

    console.log('\nVerification:');
    EXPECTED_TOOLS.forEach((name) => {
      if (toolNames.includes(name)) {
        console.log(`  ✓ ${name} is present (expected)`);
      } else {
        console.log(`  ✗ ${name} is MISSING (should be present)`);
      }
    });
  } finally {
    await client.close();
  }
}

async function main() {
  console.log('\n🧪 Multi-Server Tool Registration Test\n');

  try {
    // Test Public Server
    await testServer('Public Server', '/public/mcp');

    // Test Admin Server
    await testServer('Admin Server', '/admin/mcp');

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed!');
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

void main();
