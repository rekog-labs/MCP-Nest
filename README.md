# NestJS MCP Server Module

<div align="center">
  <img src="https://raw.githubusercontent.com/rekog-labs/MCP-Nest/main/image.png" height="200">

[![CI][ci-image]][ci-url]
[![Code Coverage][code-coverage-image]][code-coverage-url]
[![NPM Version][npm-version-image]][npm-url]
[![NPM Downloads][npm-downloads-image]][npm-url]
[![NPM License][npm-license-image]][npm-url]

</div>

A NestJS module to effortlessly expose tools, resources, and prompts for AI, from your NestJS applications using the **Model Context Protocol (MCP)**.

With `@rekog/mcp-nest` you define tools, resources, and prompts in a way that's familiar in NestJS and leverage the full power of dependency injection to utilize your existing codebase in building complex enterprise ready MCP servers.

## Features

- 🚀 **[Multi-Transport Support](docs/server-examples.md#multiple-transport-types)**: HTTP+SSE, Streamable HTTP, and STDIO
- 🔧 **[Tools](docs/tools.md)**: Expose NestJS methods as MCP tools with automatic discovery and Zod validation
  - 🛠️ **[Elicitation](docs/tools.md#interactive-tool-calls)**: Interactive tool calls with user input elicitation
  - 📊 **[Progress Notifications](docs/tools.md#tool-with-progress-reporting)**: Real-time progress updates for long-running operations
  - 🌐 **[HTTP Request Access](docs/tools.md#understanding-tool-method-parameters)**: Full access to request context within MCP handlers
- 📁 **[Resources](docs/resources.md)**: Serve content and data through MCP resource system
- 📚 **[Resource Templates](docs/resource-templates.md)**: Dynamic resources with parameterized URIs
- 💬 **[Prompts](docs/prompts.md)**: Define reusable prompt templates for AI interactions
- 🔐 **[Guard-based Authentication](docs/server-examples.md#server-with-authentication)**: Guard-based security with OAuth support
- 🏠 **[Built-in Authorization Server](docs/built-in-authorization-server.md)** — Using the built-in Authorization Server for easy setups. **(Beta)**
- 🌐 **[External Authorization Server](docs/external-authorization-server/README.md)** — Securing your MCP server with an external authorization server (Keycloak, Auth0, etc).
- 💉 **[Dependency Injection](docs/dependency-injection.md)**: Leverage NestJS DI system throughout MCP components

## Installation

```bash
npm install @rekog/mcp-nest @modelcontextprotocol/sdk zod@^3
```

### Optional dependencies

If you use the built-in authorization server with the TypeORM store, install the following optional peer dependencies:

```bash
npm install @nestjs/typeorm typeorm
```

## Quick Start

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

```typescript
// greeting.tool.ts
import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';

@Injectable()
export class GreetingTool {
  @Tool({
    name: 'greeting-tool',
    description: 'Returns a greeting with progress updates',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context) {
    await context.reportProgress({ progress: 50, total: 100 });
    return `Hello, ${name}!`;
  }
}
```

## Documentation

- **[Tools Guide](docs/tools.md)** - Define and expose NestJS methods as MCP tools
- **[Resources Guide](docs/resources.md)** - Serve static and dynamic content
- **[Resource Templates Guide](docs/resource-templates.md)** - Create parameterized resources
- **[Prompts Guide](docs/prompts.md)** - Build reusable prompt templates
- **[Built-in Authorization Server](docs/built-in-authorization-server.md)** - Secure your MCP server with built-in OAuth
- **[External Authorization Server](docs/external-authorization-server/README.md)** - Securing your MCP server with an external authorization server (Keycloak, Auth0, etc)
- **[Server examples](docs/server-examples.md)** - MCP servers examples (Streamable HTTP, HTTP, and STDIO) and with Fastify support

## Playground

The `playground` directory contains working examples for all features.
Refer to [`playground/README.md`](playground/README.md) for details.

<!-- Badges -->
[ci-url]: https://github.com/rekog-labs/MCP-Nest/actions/workflows/pipeline.yml
[ci-image]: https://github.com/rekog-labs/MCP-Nest/actions/workflows/pipeline.yml/badge.svg
[npm-url]: https://www.npmjs.com/package/@rekog/mcp-nest
[npm-version-image]: https://img.shields.io/npm/v/@rekog/mcp-nest
[npm-downloads-image]: https://img.shields.io/npm/dm/@rekog/mcp-nest
[npm-license-image]: https://img.shields.io/npm/l/@rekog/mcp-nest
[code-coverage-url]: https://codecov.io/gh/rekog-labs/mcp-nest
[code-coverage-image]: https://codecov.io/gh/rekog-labs/mcp-nest/branch/main/graph/badge.svg
