// Code taken from https://github.com/modelcontextprotocol/typescript-sdk/blob/2c2cf5b4a2c09c336558cee3078320044e875c16/src/examples/client/simpleStreamableHttp.ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolRequest,
  CallToolResultSchema,
  ListResourcesRequest,
  ListResourcesResultSchema,
  ListToolsRequest,
  ListToolsResultSchema,
  LoggingMessageNotificationSchema,
  ResourceListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';

async function main(): Promise<void> {
  // Create a new client with streamable HTTP transport
  const client = new Client({
    name: 'example-client',
    version: '1.0.0',
  });

  const transport = new StreamableHTTPClientTransport(
    new URL('http://localhost:3030/mcp'),
  );

  // TODO: Add support for notifications
  client.setNotificationHandler(
    LoggingMessageNotificationSchema,
    (notification) => {
      console.log(
        `Notification received: ${notification.params.level as string} - ${notification.params.data as string}`,
      );
    },
  );
  client.setNotificationHandler(
    ResourceListChangedNotificationSchema,
    async (_) => {
      console.log(`Resource list changed notification received!`);
      const resourcesRequest: ListResourcesRequest = {
        method: 'resources/list',
        params: {},
      };
      const resourcesResult = await client.request(
        resourcesRequest,
        ListResourcesResultSchema,
      );
      console.log(
        'Available resources count:',
        resourcesResult.resources.length,
      );
    },
  );

  // Connect the client using the transport and initialize the server
  await client.connect(transport);
  console.log('Connected to MCP server');

  // List and call tools
  await listTools(client);

  await callGreetTool(client);
  console.log(
    '\nKeeping connection open to receive notifications. Press Ctrl+C to exit.',
  );
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
    const greetRequest: CallToolRequest = {
      method: 'tools/call',
      params: {
        name: 'hello-world',
        arguments: { name: 'MCP User' },
      },
    };
    const greetResult = await client.request(
      greetRequest,
      CallToolResultSchema,
      {
        onprogress: (progress) => {
          console.log(`Progress: ${progress.progress}`);
        },
      },
    );
    console.log('Greeting result:', greetResult.content[0].text);
  } catch (error) {
    console.log(`Error calling greet tool: ${error}`);
  }
}

main().catch((error: unknown) => {
  console.error('Error running MCP client:', error);
  process.exit(1);
});
