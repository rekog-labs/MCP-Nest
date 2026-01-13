# Mutate the mcp server for advance usage or instrumentation purposes.

In some advanced use cases, you may want to mutate or extend the MCP server behavior beyond the standard configuration options. This can be achieved by providing a mutator function when setting up the MCP module in your NestJS application

## Provide a Mutator Function

When importing the `McpModule`, you can provide a mutator function that receives the MCP server instance. This function allows you to modify the server's behavior, add custom middleware, or extend its functionality.

Inject your service into any MCP tool, resource, or prompt class using standard NestJS constructor injection:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const customMutator = (server: McpServer) => {
  // do custom mutations here
  
  return server;
}

@Module({
  imports: [
    McpModule.forRoot({
      name: 'mutated-mcd-server',
      version: '0.0.1',
      serverMutator: customMutator,
    }),
  ],
  })
class AppModule {
}
```

### Example initializing sentry instrumentation

```typescript
const sentryMutator = (server: McpServer) => {
  return Sentry.wrapMcpServerWithSentry(server);
}

@Module({
  imports: [
    McpModule.forRoot({
      name: 'mutated-mcd-server',
      version: '0.0.1',
      serverMutator: sentryMutator,
    }),
  ]
})
class AppModule {
}
```

### Using multiple mutators
As mutators are just functions that take a server and return a server, you can easily compose multiple mutators together.

```typescript
const combinedMutator = (server: McpServer) => {
  const mutatedServer = firstMutator(server);
  const secondMutation = secondMutator(mutatedServer);
  
  return secondMutation;
}  // Or use reduce or some utility function to compose them

@Module({
  imports: [
    McpModule.forRoot({
      name: 'mutated-mcd-server',
      version: '0.0.1',
      serverMutator: combinedMutator,
    }),
  ]
})
class AppModule {
}
```
