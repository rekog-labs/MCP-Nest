import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ListPromptsRequest,
  ListPromptsResultSchema,
  Progress,
} from '@modelcontextprotocol/sdk/types.js';

async function main(): Promise<void> {
  // Create a new client with streamable HTTP transport
  const client = new Client({
    name: 'example-client',
    version: '1.0.0',
  });

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', './servers/stdio.ts'],
  });

  // Connect the client using the transport and initialize the server
  await client.connect(transport);
  console.log('Connected to MCP server stdio');

  // List and call tools
  await listTools(client);

  await callGreetingTools(client);

  await listPrompts(client);

  await client.close();
}

async function listTools(client: Client): Promise<void> {
  try {
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

async function callGreetingTools(client: Client): Promise<void> {
  // greet-world: no parameters
  try {
    const resultWorld: any = await client.callTool(
      { name: 'greet-world', arguments: {} },
      undefined,
      {
        onprogress: (p: Progress) => {
          if (typeof p?.progress === 'number')
            console.log(
              `[greet-world] progress: ${p.progress}/${p.total ?? 100}`,
            );
        },
      },
    );
    console.log(
      '[greet-world] result:',
      resultWorld?.content?.[0]?.text ?? resultWorld,
    );
  } catch (error) {
    console.log(`[greet-world] error: ${error}`);
  }

  // greet-user: requires name and language
  try {
    const resultUser: any = await client.callTool(
      { name: 'greet-user', arguments: { name: 'MCP User', language: 'en' } },
      undefined,
      {
        onprogress: (p: Progress) => {
          if (typeof p?.progress === 'number')
            console.log(
              `[greet-user] progress: ${p.progress}/${p.total ?? 100}`,
            );
        },
      },
    );
    console.log(
      '[greet-user] result:',
      resultUser?.content?.[0]?.text ?? resultUser,
    );
  } catch (error) {
    console.log(`[greet-user] error: ${error}`);
  }

  // greet-user-structured: returns structuredContent plus content
  try {
    const resultStructured: any = await client.callTool(
      {
        name: 'greet-user-structured',
        arguments: { name: 'MCP User', language: 'es' },
      },
      undefined,
      {
        onprogress: (p: Progress) => {
          if (typeof p?.progress === 'number')
            console.log(
              `[greet-user-structured] progress: ${p.progress}/${p.total ?? 100}`,
            );
        },
      },
    );
    if (resultStructured?.structuredContent) {
      console.log(
        '[greet-user-structured] structuredContent:',
        resultStructured.structuredContent,
      );
    }
    console.log(
      '[greet-user-structured] content:',
      resultStructured?.content?.[0]?.text ?? resultStructured,
    );
  } catch (error) {
    console.log(`[greet-user-structured] error: ${error}`);
  }
}

main().catch((error: unknown) => {
  console.error('Error running MCP client:', error);
  process.exit(1);
});
