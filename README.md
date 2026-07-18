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

- 🧩 **[NestJS Microservice Strategy](docs/migration-to-strategy.md)**: MCP runs as a `CustomTransportStrategy`, so tools/resources/prompts are real `@MessagePattern` handlers — **guards, pipes, interceptors, and exception filters apply to them natively**
- 🚀 **[Multi-Transport Support](docs/server-examples.md#multiple-transport-types)**: Streamable HTTP and STDIO — selected via the `transports` array
- 🔧 **[Tools](docs/tools.md)**: Expose NestJS methods as MCP tools with automatic discovery and Zod validation
  - 🛠️ **[Elicitation](docs/tools.md#interactive-tool-calls)**: Interactive tool calls with user input elicitation
  - 🌐 **[HTTP Request Access](docs/tools.md#understanding-tool-method-parameters)**: Full access to request context within MCP handlers
  - 🔐 **[Per-Tool Authorization](docs/per-tool-authorization.md)**: Implement fine-grained authorization for tools
- 📁 **[Resources](docs/resources.md)**: Serve content and data through MCP resource system
- 📚 **[Resource Templates](docs/resource-templates.md)**: Dynamic resources with parameterized URIs
- 💬 **[Prompts](docs/prompts.md)**: Define reusable prompt templates for AI interactions
- 🔐 **[Guard-based Authentication](docs/server-examples.md#server-with-authentication)**: Guard-based security with OAuth support
- 🏠 **[Built-in Authorization Server](docs/built-in-authorization-server.md)** — Using the built-in Authorization Server for easy setups. **(Beta)**
- 🌐 **[External Authorization Server](docs/external-authorization-server/README.md)** — Securing your MCP server with an external authorization server (Keycloak, Auth0, etc).
- 💉 **[Dependency Injection](docs/dependency-injection.md)**: Leverage NestJS DI system throughout MCP components
- 🔍 **[Server mutation and instrumentation](docs/server-mutation.md)** — Mutate the underlying mcp server for custom logic or instrumentation purposes.

**Are you interested to build ChatGPT widgets (with the OpenAI SDK) or MCP apps?**
Find out how to do that with `@rekog/MCP-Nest` in this repository [MCP-Nest-Samples](https://github.com/rinormaloku/MCP-Nest-Samples)


> [!TIP]
> You can easily learn about this package using the `chat` tab in [Context7](https://context7.com/rekog-labs/mcp-nest?tab=chat). Better yet, connect the [Context7 MCP server](https://github.com/upstash/context7#installation) to allow your AI agents to access the documentation and implement MCP-Nest for you.

## Installation

```bash
npm install @rekog/mcp-nest @modelcontextprotocol/server @modelcontextprotocol/core @modelcontextprotocol/node zod@^4
```

### Optional dependencies

The built-in authorization server now lives in a separate package. If you use it, install it alongside `@rekog/mcp-nest`:

```bash
npm install @rekog/mcp-nest-auth
```

If you additionally use the TypeORM store for the authorization server, install the following optional peer dependencies as well:

```bash
npm install @nestjs/typeorm typeorm
```

## Quick Start

MCP-Nest runs as a **NestJS microservice transport strategy**. Tools, resources,
and prompts live on `@McpController()` classes (so NestJS guards, pipes,
interceptors, and exception filters apply to them), and the strategy serves them
over one or more transports (Streamable HTTP, STDIO).

```typescript
// greeting.controller.ts
import { McpController, Tool, McpContext } from '@rekog/mcp-nest';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class GreetingController {
  @Tool({
    name: 'greeting-tool',
    description: 'Returns a greeting with progress updates',
    parameters: z.object({ name: z.string().default('World') }),
  })
  async sayHello(
    @Payload() { name }: { name: string },
    @Ctx() ctx: McpContext,
  ) {
    await ctx.reportProgress({ progress: 50, total: 100 });
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  }
}
```

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import {
  McpStrategy,
  MCP_STRATEGY,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { GreetingController } from './greeting.controller';

// The strategy is the whole configuration — there is no McpModule.
export const mcp = new McpStrategy({
  name: 'my-mcp-server',
  version: '1.0.0',
  transports: [
    new StreamableHttpTransport(),
  ],
});

@Module({
  controllers: [GreetingController],
  // Optional: only needed if a provider injects the strategy (e.g. for
  // runtime/dynamic tool registration).
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
export class AppModule {}
```

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule, mcp } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter()); // needed for HTTP transports
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices(); // mounts the MCP transports
  await app.listen(3000); // also serves your normal HTTP routes
}
void bootstrap();
```

> **Order matters:** call `startAllMicroservices()` before `listen()` so the MCP
> HTTP routes are mounted before the server starts accepting connections.

For an STDIO-only server, skip the HTTP adapter and use
`NestFactory.createMicroservice(AppModule, { strategy: mcp })` with
`transports: [new StdioTransport()]` and disable logging (stdout is reserved for
the protocol).

## Documentation

- **[Migration to the Strategy API](docs/migration-to-strategy.md)** - Moving from `McpModule.forRoot(options)` to `McpStrategy` + `@McpController`
- **[Tools Guide](docs/tools.md)** - Define and expose NestJS methods as MCP tools
- **[Discovery and Registration of Tools](docs/tool-discovery-and-registration.md)** - Automatic discovery and manual registration of tools
- **[Dynamic Capabilities Guide](docs/dynamic-capabilities.md)** - Register tools, resources, and prompts programmatically at runtime
- **[Resources Guide](docs/resources.md)** - Serve static and dynamic content
- **[Resource Templates Guide](docs/resource-templates.md)** - Create parameterized resources
- **[Prompts Guide](docs/prompts.md)** - Build reusable prompt templates
- **[Built-in Authorization Server](docs/built-in-authorization-server.md)** - Secure your MCP server with built-in OAuth
- **[External Authorization Server](docs/external-authorization-server/README.md)** - Securing your MCP server with an external authorization server (Keycloak, Auth0, etc)
- **[Server examples](docs/server-examples.md)** - MCP servers examples (Streamable HTTP, HTTP, and STDIO) and with Fastify support

## Examples

The `examples` directory contains working examples for all features.
Refer to [`examples/README.md`](examples/README.md) for details.

<!-- Badges -->
[ci-url]: https://github.com/rekog-labs/MCP-Nest/actions/workflows/pipeline.yml
[ci-image]: https://github.com/rekog-labs/MCP-Nest/actions/workflows/pipeline.yml/badge.svg
[npm-url]: https://www.npmjs.com/package/@rekog/mcp-nest
[npm-version-image]: https://img.shields.io/npm/v/@rekog/mcp-nest
[npm-downloads-image]: https://img.shields.io/npm/d18m/@rekog/mcp-nest
[npm-license-image]: https://img.shields.io/npm/l/@rekog/mcp-nest
[code-coverage-url]: https://codecov.io/gh/rekog-labs/mcp-nest
[code-coverage-image]: https://codecov.io/gh/rekog-labs/mcp-nest/branch/main/graph/badge.svg
