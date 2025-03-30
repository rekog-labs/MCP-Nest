# NestJS MCP Server Module

A NestJS module for exposing your services as an MCP (Model Context Protocol) server with Server-Sent Events (SSE) transport. This package simplifies exposing tools that clients can discover and execute via SSE.

## Features

- **SSE Transport**: Built-in `/sse` endpoint for streaming and `/messages` for handling tool execution
- **Tool Discovery**: Automatically discover and register tools using decorators
- **Tool Request Validation**: Define Zod schemas to validate tool requests.
- **Progress Notifications**: Send continuous progress updates from tools to clients.
- **Cleanup**: Define resource cleanup logic when mcp session is closed using decorator

## Installation

```bash
npm install @rekog/mcp-nest reflect-metadata @modelcontextprotocol/sdk zod
```

## Quick Start

### 1. Import Module

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { GreetingTool } from './greeting.tool';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'my-mcp-server',
      version: '1.0.0',
    })
  ],
  providers: [GreetingTool]
})
export class AppModule {}
```

### 2. Define Tools

```typescript
// greeting.tool.ts
import { Injectable } from '@nestjs/common';
import { Tool, Cleanup } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Context } from '@rekog/mcp-nest/dist/services/mcp-tools.discovery';
import { CleanupContext } from '@rekog/mcp-nest/dist/services/cleanup.service';
import { Progress } from '@modelcontextprotocol/sdk/types';

@Injectable()
export class GreetingTool {
  constructor() {}

  @Tool({
    name: 'hello-world',
    description:
      'Returns a greeting and simulates a long operation with progress updates',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context) {
    const { request } = context;

    // retrieve unique session id of the current tool call
    const sessionId = req.query.sessionId as string;

    const greeting = `Hello, ${name}!`;

    const totalSteps = 5;
    for (let i = 0; i < totalSteps; i++) {
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Send a progress update.
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [{ type: 'text', text: greeting }],
    };
  }

  @Cleanup()
  async onSessionClose(context: CleanupContext) {

    const sessionId = context.sessionId;
    // cleanup resources on session close
  }

}
```

You are done!

## Client Connection

Clients can connect using the MCP SDK:

```typescript
// client.ts
import { Client } from '@modelcontextprotocol/sdk/client';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse';

const client = new Client(
  { name: 'client-name', version: '1.0.0' },
  { capabilities: {} }
);

await client.connect(
  new SSEClientTransport(new URL('http://localhost:3000/sse'))
);

// Execute the 'hello-world' tool with progress tracking
const greetResult = await client.callTool(
  {
    name: 'hello-world',
    arguments: {
      name: 'MCP User',
    },
  },
  undefined, // responseSchema is optional, or you can define a Zod schema here
  {
    onprogress: (progress) => {
      console.log(
        `Progress: ${progress.progress}/${progress.total}`
      );
    },
  },
);

console.log(greetResult.content[0].text); // Output: Hello MCP User! I'm Test User from Test Org.
```

## API Endpoints

- `GET /sse`: SSE connection endpoint
- `POST /messages`: Tool execution endpoint

## Configuration Reference

### `McpOptions`

| Property             | Type                      | Description                                                                 | Default Value |
|----------------------|---------------------------|-----------------------------------------------------------------------------|---------------|
| `name`               | string                    | Server name                                                                 | -             |
| `version`            | string                    | Server version                                                              | -             |
| `capabilities`       | Record<string, any>       | Server capabilities, defines what the server can do.                        | `{}`          |
| `sseEndpoint`        | string (optional)         | Endpoint for SSE connections.                                               | `'sse'`       |
| `messagesEndpoint`   | string (optional)         | Endpoint for handling tool execution.                                        | `'messages'`  |
| `globalApiPrefix`    | string (optional)         | Global API prefix for all endpoints.                                        | `''`          |

### Tool Decorator

The `@Tool` decorator is used to define a method as an MCP tool.

```typescript
@Tool({ name: string, description: string, parameters?: z.ZodObject<any> })
```

- `name`: The name of the tool. This will be used to list it in the `listTools` request.
- `description`: A description of the tool.
- `parameters`: (Optional) A Zod schema defining the expected structure of the tool's input arguments.
