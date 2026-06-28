# Mutate the mcp server for advance usage or instrumentation purposes.

In some advanced use cases, you may want to mutate or extend the MCP server behavior beyond the standard configuration options. This can be achieved by providing a mutator function when configuring the `McpStrategy` in your NestJS application.

## Provide a Mutator Function

When constructing the `McpStrategy`, you can provide a `serverMutator` function that receives the MCP server instance. This function allows you to modify the server's behavior, add custom middleware, or extend its functionality.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';

const customMutator = (server: McpServer) => {
  // do custom mutations here

  return server;
};

export const mcp = new McpStrategy({
  name: 'mutated-mcp-server',
  version: '0.0.1',
  serverMutator: customMutator,
  transports: [new StreamableHttpTransport()],
});
```

### Example initializing sentry instrumentation

```typescript
const sentryMutator = (server: McpServer) => {
  return Sentry.wrapMcpServerWithSentry(server);
};

export const mcp = new McpStrategy({
  name: 'mutated-mcp-server',
  version: '0.0.1',
  serverMutator: sentryMutator,
  transports: [new StreamableHttpTransport()],
});
```

### Using multiple mutators

As mutators are just functions that take a server and return a server, you can easily compose multiple mutators together.

```typescript
const combinedMutator = (server: McpServer) => {
  const mutatedServer = firstMutator(server);
  const secondMutation = secondMutator(mutatedServer);

  return secondMutation;
}; // Or use reduce or some utility function to compose them

export const mcp = new McpStrategy({
  name: 'mutated-mcp-server',
  version: '0.0.1',
  serverMutator: combinedMutator,
  transports: [new StreamableHttpTransport()],
});
```
