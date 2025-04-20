// Code taken from https://github.com/modelcontextprotocol/typescript-sdk/blob/2c2cf5b4a2c09c336558cee3078320044e875c16/src/examples/client/simpleStreamableHttp.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'; // Remove this line
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'; // Add this line
import {
  Progress, // Add this import for onprogress type
} from '@modelcontextprotocol/sdk/types.js';

async function main(): Promise<void> {
  // Create a new client with streamable HTTP transport
  const client = new Client({
    name: 'example-client',
    version: '1.0.0',
  });

  // Use SSEClientTransport instead of StreamableHTTPClientTransport
  const transport = new SSEClientTransport(
    new URL('http://localhost:3030/sse'), // Point to the /sse endpoint
  );

  // Connect the client using the transport and initialize the server
  await client.connect(transport);
  console.log('Connected to MCP server via SSE');

  // List and call tools
  await listTools(client);

  // Remove duplicate call
  // await listTools(client);

  await callGreetTool(client);
  console.log(
    '\nKeeping connection open to receive notifications. Press Ctrl+C to exit.',
  );
}

async function listTools(client: Client): Promise<void> {
  try {
    // Use the client helper method
    const toolsResult = await client.listTools();
    console.log('Available tools: ', toolsResult.tools);
    if (toolsResult.tools.length === 0) {
      console.log('No tools available from the server');
    }
  } catch (error) {
    console.log(`Tools not supported by this server (${error})`);
    return;
  }
}

async function callGreetTool(client: Client): Promise<void> {
  try {
    // Use the client helper method
    const greetResult: any = await client.callTool(
      {
        name: 'hello-world',
        arguments: { name: 'MCP User' },
      },
      undefined, // No specific resource ID needed
      {
        onprogress: (progress: Progress) => {
          // Use Progress type
          console.log(`Progress: ${progress.progress}`);
        },
      },
    );
    // Assuming result structure is consistent with CallToolResult
    console.log('Greeting result:', greetResult.content[0].text);
  } catch (error) {
    console.log(`Error calling greet tool: ${error}`);
  }
}

main()
  .then(() => {
    console.log('Client connected successfully.');
  })
  .catch((error: unknown) => {
    // Make catch async
    console.error('Error running MCP client:', error);
    process.exit(1);
  });
