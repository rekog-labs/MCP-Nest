# Custom Endpoints

> **Migrated:** This example used to disable the auto-generated transports and
> hand-write a controller around `McpStreamableHttpService`. That whole mechanism
> is gone. Transports now mount their own routes on the Nest HTTP adapter, so
> customizing an endpoint is just a transport option.

## When You Need This

Use a custom transport configuration when you need:

- **Custom routing**: Serve MCP on a non-default path (e.g. `/api/mcp`).
- **Multiple servers in one app**: Mount several `McpStrategy` instances on distinct endpoints (see [`../multi-server-example`](../multi-server-example)).
- **Stateful vs stateless**: Toggle session management or JSON responses per transport.

For request-level concerns:

- **Authentication**: Add Express middleware via `app.use(...)` that validates the token and sets `req.user` (see [`../server-oauth.ts`](../server-oauth.ts) / [`../server-simple-jwt.ts`](../server-simple-jwt.ts)). The bespoke `ToolAuthorizationService` reads `req.user`.
- **Guards / pipes / interceptors / filters**: Because every tool is a real NestJS RPC handler, apply standard `@UseGuards()`, `@UsePipes()`, etc. directly on the `@McpController` class or method — they run inside the RPC pipeline.

## How to Implement

### Step 1: Configure the transport endpoint

```typescript
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';

const strategy = new McpStrategy({
  name: 'my-server',
  version: '1.0.0',
  transports: [
    new StreamableHttpTransport({ endpoint: '/mcp' }), // any custom path
  ],
});
```

`StreamableHttpTransport` accepts `endpoint`, `statelessMode`, `enableJsonResponse`,
and `sessionIdGenerator`. `SseTransport` accepts `sseEndpoint` / `messagesEndpoint`.

### Step 2: Declare your capabilities as controllers and connect the strategy

```typescript
@Module({
  controllers: [GreetingTool, GreetingResource, GreetingPrompt],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
strategy.setHttpAdapter(app.getHttpAdapter());
app.connectMicroservice({ strategy });
await app.startAllMicroservices(); // BEFORE listen()
await app.listen(3030);
```

## Running the Example

```bash
npx ts-node-dev --respawn playground/servers/custom-controllers/server.ts
```

## Testing with MCP Inspector

The server exposes the Streamable HTTP endpoint:

- **Streamable HTTP Transport**: `http://localhost:3030/mcp`

Use [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to connect
and test tool calls, resource requests, and prompt interactions.

## Example Files

- `server.ts` - Strategy server mounting Streamable HTTP on a custom `/mcp` endpoint.
