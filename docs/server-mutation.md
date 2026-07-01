# Mutate the mcp server for advanced usage or instrumentation purposes.

In some advanced use cases, you may want to mutate or extend the MCP server behavior beyond the standard configuration options. This can be achieved by providing a mutator function when configuring the `McpStrategy` in your NestJS application.

The primary use case — and the reason this hook exists — is **instrumentation**: wrapping the server so that tracing/observability tools (e.g. Sentry) can capture spans for every tool execution, resource access, and prompt call.

## Provide a Mutator Function

When constructing the `McpStrategy`, you can provide a `serverMutator` function that receives the MCP server instance. It runs once per server creation, and whatever it returns is used as the server. This lets you wrap the server to observe or extend its behavior.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';

const customMutator = (server: McpServer) => {
  // wrap or extend the server here

  return server;
};

export const mcp = new McpStrategy({
  name: 'mutated-mcp-server',
  version: '0.0.1',
  serverMutator: customMutator,
  transports: [new StreamableHttpTransport()],
});
```

## Instrumentation with Sentry

Sentry ships a drop-in wrapper, `wrapMcpServerWithSentry`, that captures spans for your MCP server workflows (tool executions, resource access, and client connections). It requires `@sentry/node` >= 9.46.0, and Sentry must be initialized before the server is wrapped.

```typescript
import * as Sentry from '@sentry/node';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
});

const sentryMutator = (server: McpServer) =>
  Sentry.wrapMcpServerWithSentry(server, {
    recordInputs: true, // capture tool/prompt call arguments
    recordOutputs: true, // capture tool/prompt results
  });

export const mcp = new McpStrategy({
  name: 'mutated-mcp-server',
  version: '0.0.1',
  serverMutator: sentryMutator,
  transports: [new StreamableHttpTransport()],
});
```

The mutator runs *before* the strategy installs its handlers for the decorator-discovered tools, so a wrapper like this instruments those tools too — not just tools registered directly on the server.

For a dependency-free illustration of the same idea (a `tracingMutator` that times and logs every request, including decorator tools), see the runnable [`server-mutation` example](../examples/server-mutation/).

## Using multiple mutators

Mutators are just functions that take a server and return a server, so you can compose several together.

```typescript
const combinedMutator = (server: McpServer) =>
  [firstMutator, secondMutator].reduce((s, mutate) => mutate(s), server);

export const mcp = new McpStrategy({
  name: 'mutated-mcp-server',
  version: '0.0.1',
  serverMutator: combinedMutator,
  transports: [new StreamableHttpTransport()],
});
```

## A note on registering tools in a mutator

The mutator is intended for **wrapping/instrumenting** the server, not for adding tools. If at least one `@Tool`-decorated method exists anywhere in the app, tools you register directly (`server.registerTool(...)`) inside a mutator are silently excluded from `tools/list` and return `Unknown tool` on `tools/call` — the strategy binds its own handlers that enumerate only decorator-discovered tools. To add tools at runtime, use the strategy's `registerTool()` / `registerResource()` / `registerPrompt()` methods instead (see [Dynamic Capabilities](./dynamic-capabilities.md)).
