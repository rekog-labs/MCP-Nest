#!/usr/bin/env node
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolRequest,
  CallToolResultSchema,
  ListToolsRequest,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

async function main(): Promise<void> {
  // Test with Fastify server
  const fastifyPort = 3031;
  console.log(`🧪 Testing Fastify MCP server on port ${fastifyPort}`);

  const client = new Client({
    name: 'fastify-test-client',
    version: '1.0.0',
  });

  const transport = new StreamableHTTPClientTransport(
    new URL(`http://localhost:${fastifyPort}/mcp`),
  );

  try {
    // Connect the client using the transport and initialize the server
    await client.connect(transport);
    console.log('✅ Connected to Fastify MCP server');

    // List available tools
    await listTools(client);

    // Call the greeting tool
    await callGreetTool(client);

    console.log('✅ Fastify server test completed successfully!');
  } catch (error) {
    console.error('❌ Error testing Fastify server:', error);
    console.log('\nTrouble shooting:');
    console.log('1. Make sure the Fastify server is running on port 3031');
    console.log('2. Run: cd playground && npm run start:fastify');
    console.log('3. Make sure @nestjs/platform-fastify is installed');
  }

  console.log('\nKeeping connection open for a few seconds...');
  setTimeout(() => {
    console.log('Disconnecting...');
    process.exit(0);
  }, 3000);
}

async function listTools(client: Client): Promise<void> {
  try {
    const toolsRequest: ListToolsRequest = {
      method: 'tools/list',
      params: {},
    };
    const toolsResult = await client.request(
      toolsRequest,
      ListToolsResultSchema,
    );
    console.log(
      '📋 Available tools:',
      toolsResult.tools.map((t) => t.name),
    );
    if (toolsResult.tools.length === 0) {
      console.log('No tools available from the server');
    }
  } catch (error) {
    console.log(`❌ Tools not supported by this server (${error})`);
    return;
  }
}

async function callGreetTool(client: Client): Promise<void> {
  try {
    const greetRequest: CallToolRequest = {
      method: 'tools/call',
      params: {
        name: 'hello-world',
        arguments: { name: 'Fastify User' },
      },
    };
    const greetResult = await client.request(
      greetRequest,
      CallToolResultSchema,
      {
        onprogress: (progress) => {
          console.log(`⏳ Progress: ${progress.progress}%`);
        },
      },
    );
    console.log('🎉 Greeting result:', greetResult.content[0].text);
  } catch (error) {
    console.log(`❌ Error calling greet tool: ${error}`);
  }
}

main()
  .then(() => {
    console.log('Test completed.');
  })
  .catch((error: unknown) => {
    console.error('Error running Fastify test client:', error);
    process.exit(1);
  });
