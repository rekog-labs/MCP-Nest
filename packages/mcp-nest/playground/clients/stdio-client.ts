import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  CallToolRequest,
  CallToolResultSchema,
  ListPromptsRequest,
  ListPromptsResultSchema,
  ListToolsRequest,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';

async function main(): Promise<void> {
  // Create a new client with streamable HTTP transport
  const client = new Client({
    name: 'example-client',
    version: '1.0.0',
  });

  const transport = new StdioClientTransport({
    command: 'ts-node-dev',
    args: ['--respawn', 'playground/servers/stdio.ts'],
  });

  // Connect the client using the transport and initialize the server
  await client.connect(transport);
  console.log('Connected to MCP server stdio');

  // List and call tools
  await listTools(client);

  await callGreetTool(client);

  await listPrompts(client);
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

async function listPrompts(client: Client): Promise<void> {
  try {
    const promptsRequest: ListPromptsRequest = {
      method: 'prompts/list',
      params: {},
    };
    const promptsResult = await client.request(
      promptsRequest,
      ListPromptsResultSchema,
    );
    console.log('Available prompts: ', promptsResult.prompts);
  } catch (error) {
    console.log(`Prompts not supported by this server (${error})`);
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
