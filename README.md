# NestJS MCP Server Module

[![smithery badge](https://smithery.ai/badge/@rekog-labs/Nest-MCP)](https://smithery.ai/server/@rekog-labs/Nest-MCP)

A NestJS module for exposing your services as an MCP (Model Context Protocol) server with Server-Sent Events (SSE) transport. This package simplifies exposing tools that clients can discover and execute via SSE.

## Features

- **SSE Transport**: Built-in `/sse` endpoint for streaming and `/messages` for handling tool execution
- **Tool Discovery**: Automatically discover and register tools using decorators
- **Tool Request Validation**: Define Zod schemas to validate tool requests.
- **Progress Notifications**: Send continuous progress updates from tools to clients.
- **Authentication**: Integrates with NestJS Guards for securing endpoints.

## Installation

### Installing via Smithery

To install NestJS MCP Server Module for Claude Desktop automatically via [Smithery](https://smithery.ai/server/@rekog-labs/Nest-MCP):

```bash
npx -y @smithery/cli install @rekog-labs/Nest-MCP --client claude
```

### Manual Installation
```bash
npm install @rekog/mcp-nest reflect-metadata @modelcontextprotocol/sdk zod @nestjs/common @nestjs/core
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
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
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
}
```

You are done!

## Authentication

You can secure your MCP endpoints using standard NestJS Guards.

### 1. Create a Guard

Implement the `CanActivate` interface. The guard should handle request validation (e.g., checking JWTs, API keys) and optionally attach user information to the request object.
<details>
<summary>Example Guard Implementation</summary>

```typescript
// auth.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Observable } from 'rxjs';

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(
    context: ExecutionContext,
  ): boolean | Promise<boolean> | Observable<boolean> {
    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;

    // Example: Check for a specific Bearer token
    if (authorization && authorization.startsWith('Bearer ')) {
      const token = authorization.substring(7);
      if (token === 'your-secret-token') {
        // Attach user info if needed (optional)
        request.user = { id: 'user-123', roles: ['admin'] };
        return true; // Allow access
      }
    }

    return false; // Deny access
  }
}
```

</details>

### 2. Apply the Guard

Pass your guard(s) to the `McpModule.forRoot` configuration. The guard(s) will be applied to both the `/sse` and `/messages` endpoints.

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { GreetingTool } from './greeting.tool';
import { AuthGuard } from './auth.guard';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'my-mcp-server',
      version: '1.0.0',
      guards: [AuthGuard] // Apply the guard here
    })
  ],
  providers: [GreetingTool, AuthGuard] // Ensure the Guard is also provided
})
export class AppModule {}
```

### 3. Access User Context in Tools (Optional)

If your guard attaches user information to the `request` object (e.g., `request.user = ...`), you can access it in your tool as the third parameter.

```typescript
// authenticated-greeting.tool.ts
import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';
import { Request } from 'express'; // Import Request from express

@Injectable()
export class AuthenticatedGreetingTool {

  @Tool({
    name: 'auth-hello-world',
    description: 'Greets the authenticated user',
    parameters: z.object({}), // No parameters needed for this example
  })
  // Add 'request' as the third parameter
  async sayAuthHello(args: {}, context: Context, request: Request & { user?: { id: string } }) {
    const userId = request.user?.id || 'Anonymous';
    const greeting = `Hello, user ${userId}!`;

    return {
      content: [{ type: 'text', text: greeting }],
    };
  }
}
```

*Note: Ensure your tool (`AuthenticatedGreetingTool` in this example) is added to the `providers` array in your `AppModule`.*

## Client Connection

Clients need to provide the necessary credentials (e.g., Authorization header) when connecting if authentication is enabled.

### Unauthenticated Client

```typescript
// client.ts (no authentication)
import { Client } from '@modelcontextprotocol/sdk/client';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse';

const client = new Client(
  { name: 'client-name', version: '1.0.0' },
  { capabilities: {} }
);

await client.connect(
  new SSEClientTransport(new URL('http://localhost:3000/sse'))
);

// ... list tools, call tools etc.
```

### Authenticated Client

Pass request options (like headers) to the `SSEClientTransport`.

```typescript
// client.ts (with authentication)
import { Client } from '@modelcontextprotocol/sdk/client';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse';

const client = new Client(
  { name: 'client-name', version: '1.0.0' },
  { capabilities: {} }
);

const transport = new SSEClientTransport(
  new URL('http://localhost:3000/sse'),
  {
    // Provide necessary credentials here
    requestInit: {
      headers: {
        Authorization: 'Bearer your-secret-token' // Match guard expectation
      }
    }
  }
);

await client.connect(transport);


// Execute the 'auth-hello-world' tool
const greetResult = await client.callTool(
  {
    name: 'auth-hello-world',
    arguments: {},
  },
  undefined, // responseSchema is optional
  {
    onprogress: (progress) => { // Example progress handler
      console.log(
        `Progress: ${progress.progress}/${progress.total}`
      );
    },
  },
);

console.log(greetResult.content[0].text); // Output: Hello, user user-123!
```

## API Endpoints

- `GET /sse`: SSE connection endpoint (Protected by guards if configured)
- `POST /messages`: Tool execution endpoint (Protected by guards if configured)

## Configuration Reference

### `McpOptions`

| Property             | Type                      | Description                                                                 | Default Value |
|----------------------|---------------------------|-----------------------------------------------------------------------------|---------------|
| `name`               | string                    | Server name                                                                 | -             |
| `version`            | string                    | Server version                                                              | -             |
| `capabilities`       | Record<string, any>       | Server capabilities, defines what the server can do.                        | `{}`          |
| `guards`             | `any[]` (NestJS Guards)   | An array of NestJS Guards to apply to the MCP endpoints.                    | `[]`          |
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

### Context Parameter

The second parameter passed to a `@Tool` decorated method is the `Context` object.

- `context.reportProgress(progress: Progress)`: Sends a progress update message to the client. `Progress` typically has `{ progress: number, total: number }`.

### Request Paramter

The third parameter passed to a `@Tool` decorated method is the `Request` object.

- `request`: The request object from the underlying HTTP framework (e.g., Express). This can be used to access headers, query parameters, etc.
