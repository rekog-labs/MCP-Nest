/**
 * Test script to verify tools are registered correctly to each server
 * Run with: npx ts-node playground/servers/multi-server-example/test-tools.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const SERVER_URL = 'http://localhost:3000';

async function testServer(serverName: string, sseEndpoint: string, messagesEndpoint: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing ${serverName}`);
  console.log('='.repeat(60));

  const transport = new SSEClientTransport(
    new URL(sseEndpoint, SERVER_URL),
    new URL(messagesEndpoint, SERVER_URL),
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

    if (serverName === 'Public Server') {
      const expected = ['get-weather', 'list-cities', 'send-notification', 'get-notifications', 'mark-notification-read'];
      const unexpected = ['get-metrics', 'track-request'];

      console.log('\nVerification:');
      expected.forEach(name => {
        if (toolNames.includes(name)) {
          console.log(`  ✓ ${name} is present (expected)`);
        } else {
          console.log(`  ✗ ${name} is MISSING (should be present)`);
        }
      });

      unexpected.forEach(name => {
        if (!toolNames.includes(name)) {
          console.log(`  ✓ ${name} is absent (expected)`);
        } else {
          console.log(`  ✗ ${name} is PRESENT (should be absent)`);
        }
      });
    } else if (serverName === 'Admin Server') {
      const expected = ['get-metrics', 'track-request', 'send-notification', 'get-notifications', 'mark-notification-read'];
      const unexpected = ['get-weather', 'list-cities'];

      console.log('\nVerification:');
      expected.forEach(name => {
        if (toolNames.includes(name)) {
          console.log(`  ✓ ${name} is present (expected)`);
        } else {
          console.log(`  ✗ ${name} is MISSING (should be present)`);
        }
      });

      unexpected.forEach(name => {
        if (!toolNames.includes(name)) {
          console.log(`  ✓ ${name} is absent (expected)`);
        } else {
          console.log(`  ✗ ${name} is PRESENT (should be absent)`);
        }
      });
    }
  } finally {
    await client.close();
  }
}

async function main() {
  console.log('\n🧪 Multi-Server Tool Registration Test\n');

  try {
    // Test Public Server
    await testServer('Public Server', '/public/sse', '/public/messages');

    // Test Admin Server
    await testServer('Admin Server', '/admin/sse', '/admin/messages');

    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed!');
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();
