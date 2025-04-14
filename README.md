# NestJS MCP Server Module

<p align="center">
  <img src="https://raw.githubusercontent.com/rekog-labs/MCP-Nest/main/image.png" height="200">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@rekog/mcp-nest" target="_blank"><img alt="npm version" src="https://img.shields.io/npm/v/@rekog/mcp-nest" /></a>
  <a href="https://www.npmjs.com/package/@rekog/mcp-nest" target="_blank"><img alt="npm downloads" src="https://img.shields.io/npm/dm/@rekog/mcp-nest" /></a>
  <a href="https://www.npmjs.com/package/@rekog/mcp-nest" target="_blank"><img alt="NPM" src="https://img.shields.io/npm/l/@rekog/mcp-nest" /></a>
</p>

A NestJS module to effortlessly expose tools, resources, and prompts for AI, from your NestJS applications using the **Model Context Protocol (MCP)**.

`@rekog/mcp-nest` handles the complexity of setting up MCP servers. You define tools, resources, and prompts in a way that's familiar in NestJS and leverage the full power of dependency injection to utilize your existing services.

## Features

- 🚀 HTTP+SSE and Streamable HTTP Transport
- 🔍 Automatic `tool`, `resource`, and `prompt` discovery and registration
- 💯 Zod-based request validation
- 📊 Progress notifications
- 🔒 Guard-based authentication

## Installation

```bash
npm install @rekog/mcp-nest @modelcontextprotocol/sdk zod
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
    }),
  ],
  providers: [GreetingTool],
})
export class AppModule {}
```

### 2. Define Tools and Resource

```typescript
// greeting.tool.ts
import { Injectable } from '@nestjs/common';
import { Tool, Resource, Context } from '@rekog/mcp-nest';
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

  @Resource({
    uri: 'mcp://hello-world/{userName}',
    name: 'Hello World',
    description: 'A simple greeting resource',
    mimeType: 'text/plain',
  })
  // Different from the SDK, we put the parameters and URI in the same object.
  async getCurrentSchema({ uri, userName }) {
    return {
      content: [
        {
          uri,
          text: `User is ${userName}`,
          mimeType: 'text/plain',
        },
      ],
    };
  }
}
```

You are done!

## API Endpoints

- `GET /sse`: SSE connection endpoint (Protected by guards if configured)
- `POST /messages`: Tool execution endpoint (Protected by guards if configured)

### Tips

It's possible to use the module with global prefix, but the recommended way is to exclude those endpoints with:

```typescript
app.setGlobalPrefix('/api', { exclude: ['sse', 'messages'] });
```

## Authentication

You can secure your MCP endpoints using standard NestJS Guards.

### 1. Create a Guard

Implement the `CanActivate` interface. The guard should handle request validation (e.g., checking JWTs, API keys) and optionally attach user information to the request object.

Nothing special, check the NestJS documentation for more details.

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
      guards: [AuthGuard], // Apply the guard here
    }),
  ],
  providers: [GreetingTool, AuthGuard], // Ensure the Guard is also provided
})
export class AppModule {}
```

That's it! The rest is the same as NestJS Guards.
