# Server Examples

This guide walks through different ways to set up MCP servers using mcp-nest with various transport types and configurations. Each pattern below links to its explanation in this document and to a runnable example in the playground:

- [Stateful MCP Server](#stateful-mcp-server) — [`server-stateful.ts`](../playground/servers/server-stateful.ts)
- [Stateless MCP Server](#stateless-mcp-server) — [`server-stateless.ts`](../playground/servers/server-stateless.ts)
- [STDIO MCP Server](#stdio-server) — [`stdio.ts`](../playground/servers/stdio.ts)
- [Fastify Adapter](#fastify-server) — [`server-stateful-fastify.ts`](../playground/servers/server-stateful-fastify.ts)
- [OAuth Authentication](#server-with-authentication) — [`server-oauth.ts`](../playground/servers/server-oauth.ts)
- [Custom Request Handling](#custom-request-handling)
- [Async Configuration](#async-configuration)
- [Multiple Transports](#multiple-transport-types)
- [Custom Endpoints](#custom-endpoints)
- [Global Prefix Integration](#global-prefix-integration)

## Stateful MCP Server

The most common setup for web applications with session management:

```typescript
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  MCP_STRATEGY,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { GreetingTool } from './greeting.tool';
import { GreetingResource } from './greeting.resource';
import { GreetingPrompt } from './greeting.prompt';

// The strategy is the whole configuration — there is no McpModule.
const mcp = new McpStrategy({
  name: 'playground-mcp-server',
  version: '0.0.1',
  transports: [
    // Stateless is the default; opt into session management with statefulMode.
    new StreamableHttpTransport({ statefulMode: true }),
  ],
});

@Module({
  // Capability classes are @McpController() and go in `controllers`.
  controllers: [GreetingResource, GreetingTool, GreetingPrompt],
  // Optional: only needed if a provider injects the strategy (e.g. dynamic registration).
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter()); // needed for HTTP transports
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices(); // BEFORE listen()
  await app.listen(3030);
  console.log('MCP server started on port 3030');
}

void bootstrap();
```

> **Order matters:** call `startAllMicroservices()` before `listen()` so the MCP HTTP routes are mounted before the server starts accepting connections.

**Endpoints exposed:**

- `POST /mcp` - Main MCP operations
- `GET /mcp` - SSE stream for real-time updates
- `DELETE /mcp` - Session termination

**Run:**

```bash
npx ts-node-dev --respawn playground/servers/server-stateful.ts
```

**Test:**

```bash
npx @modelcontextprotocol/inspector@0.16.2
```

Connect to: `http://localhost:3030/mcp`

## Stateless MCP Server

Simpler setup without session management, good for REST-like usage. This is the
**default** mode — a bare `new StreamableHttpTransport()` is stateless and
returns a JSON reply to a plain POST (no SSE stream to manage):

```typescript
const mcp = new McpStrategy({
  name: 'playground-mcp-server',
  version: '0.0.1',
  transports: [new StreamableHttpTransport()],
});

@Module({
  controllers: [GreetingResource, GreetingTool, GreetingPrompt],
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
class AppModule {}

// Bootstrap is identical to the stateful server (setHttpAdapter +
// connectMicroservice + startAllMicroservices + listen).
```

**Endpoints exposed:**

- `POST /mcp` - All MCP operations

**Run:**

```bash
npx ts-node-dev --respawn playground/servers/server-stateless.ts
```

## STDIO Server

For command-line tools and desktop applications. STDIO is session-aware (it supports progress and logging), but stdout carries the protocol, so disable logging (`logging: false` on the strategy + `{ logger: false }` on the app):

```typescript
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpStrategy, StdioTransport } from '@rekog/mcp-nest';
import { GreetingTool } from './greeting.tool';
import { GreetingResource } from './greeting.resource';
import { GreetingPrompt } from './greeting.prompt';

const mcp = new McpStrategy({
  name: 'playground-stdio-server',
  version: '0.0.1',
  transports: [new StdioTransport()],
  logging: false, // stdout is reserved for the protocol
});

@Module({
  controllers: [GreetingTool, GreetingPrompt, GreetingResource],
})
class AppModule {}

async function bootstrap() {
  // STDIO needs no HTTP adapter — create a pure microservice.
  const app = await NestFactory.createMicroservice(AppModule, {
    strategy: mcp,
    logger: false, // Disable logging for STDIO
  });
  await app.listen();
}

void bootstrap();
```

**Run:**

```bash
npx ts-node-dev --respawn playground/servers/stdio.ts
```

**Test with MCP Client:**
After building, configure in your MCP client:

```json
{
  "mcpServers": {
    "greeting": {
      "command": "node",
      "args": ["dist/playground/servers/stdio.js"]
    }
  }
}
```

## Multiple Transport Types

You select transports by passing instances in the `transports` array. Each transport mounts its own routes:

```typescript
import {
  McpStrategy,
  StreamableHttpTransport,
  // StdioTransport,
} from '@rekog/mcp-nest';

const mcp = new McpStrategy({
  name: 'multi-transport-server',
  version: '0.0.1',
  transports: [
    new StreamableHttpTransport(),
    // new StdioTransport(), // Uncomment to enable STDIO
  ],
});

@Module({
  controllers: [GreetingTool],
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
class AppModule {}
```

**Endpoints exposed:**

- `POST /mcp` - Streamable HTTP operations

## Server with Authentication

MCP HTTP routes are mounted on the HTTP adapter (not as Nest controllers), so authentication has two parts:

- **Authenticate** with Express middleware that sets `req.user` (and rejects with 401 when appropriate). The bespoke `ToolAuthorizationService` reads `req.user` to enforce `@PublicTool`, `@ToolScopes`, and `@ToolRoles`.
- **Enforce** per-tool access with standard `@UseGuards()` on the `@McpController` class or method — these run inside the RPC pipeline. In a guard, read the context with `context.switchToRpc().getContext<McpContext>()` and `.getRawRequest()`.

If you use the built-in OAuth authorization server (`McpAuthModule`), install the auth package alongside `@rekog/mcp-nest`:

```bash
npm install @rekog/mcp-nest-auth
```

```typescript
import { AuthMiddleware } from './auth.middleware';

const mcp = new McpStrategy({
  name: 'secure-mcp-server',
  version: '0.0.1',
  transports: [new StreamableHttpTransport()],
});

@Module({
  controllers: [GreetingTool],
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Authenticate before the MCP transports handle the request.
  app.use(new AuthMiddleware().use);
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(3030);
}
```

Standard `@UseGuards()` on `@McpController` classes and methods are applied automatically by the RPC pipeline at call time. Combine them with `@PublicTool()`, `@ToolScopes()`, and `@ToolRoles()` (which read `req.user` via the bespoke authorization service) and the `allowUnauthenticatedAccess` flag to control per-tool visibility. See [Per-Tool Authorization](per-tool-authorization.md) for details.

### Disabling OAuth Discovery Endpoints

If you want to define the endpoints yourself, then you can disable the default discovery endpoints:

```typescript
@Module({
  imports: [
    McpAuthModule.forRoot({
      // ... required options
      disableEndpoints: {
        wellKnownAuthorizationServerMetadata: true,
        wellKnownProtectedResourceMetadata: false,
      },
    }),
  ],
  controllers: [GreetingTool],
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
class AppModule {}
```

## Fastify Server

Using Fastify instead of Express. The strategy wiring is the same — the HTTP adapter just happens to be Fastify:

```typescript
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(3030, '0.0.0.0');
  console.log('Fastify MCP server started on port 3030');
}
```

**Run:**

```bash
npx ts-node-dev --respawn playground/servers/server-stateful-fastify.ts
```

## Testing Your Servers

### Using MCP Inspector

1. Start your server
2. Run the inspector:

   ```bash
   npx @modelcontextprotocol/inspector@0.16.2
   ```

3. Connect to your server URL
4. Test tools, resources, and prompts interactively

### Using curl (HTTP servers)

```bash
# List available tools
curl -X POST http://localhost:3030/mcp \
  -H "Content-Type: application/json" \
  -d '{"method": "tools/list"}'

# Execute a tool
curl -X POST http://localhost:3030/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "method": "tools/call",
    "params": {
      "name": "greet-user",
      "arguments": {"name": "Alice", "language": "en"}
    }
  }'
```

## Custom Request Handling

Because every tool/resource/prompt is a real `@MessagePattern` handler, the full NestJS RPC pipeline applies — you no longer need bespoke controllers (the old `createStreamableHttpController`/`createSseController` factories and `McpStreamableHttpService` have been removed). Apply custom guards, pipes, and interceptors directly with standard NestJS decorators:

```typescript
@McpController()
@UseGuards(MyGuard)
@UseInterceptors(MyInterceptor)
export class GreetingTool {
  @Tool({ name: 'greet-user', description: '...', parameters: z.object({ name: z.string() }) })
  @UsePipes(MyPipe)
  greet(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: `Hello ${name}` }] };
  }
}
```

In a guard/interceptor, read the MCP context with `context.switchToRpc().getContext<McpContext>()` and the raw HTTP request via `.getRawRequest()`.

To customize endpoint paths, set them on the transport constructors (see [Custom Endpoints](#custom-endpoints)). If you need to mount additional routes, add normal Nest controllers to the module's `controllers` array alongside your `@McpController` classes — they share the same HTTP adapter.

## Async Configuration

There is no `forRootAsync` because the strategy is a plain object you construct yourself — resolve any async/config values before building it:

```typescript
async function bootstrap() {
  const config = await loadConfig();

  const mcp = new McpStrategy({
    name: config.mcpName ?? 'async-mcp-server',
    version: config.mcpVersion ?? '0.0.1',
    transports: [new StreamableHttpTransport()],
  });

  @Module({
    controllers: [GreetingTool],
    providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(3030);
}
```

If you need `ConfigService`, instantiate the Nest app first and read config from `app.get(ConfigService)`, then construct/connect the strategy before `startAllMicroservices()`.

## Custom Endpoints

Endpoints are set directly on the transport constructors — there is no longer an `apiPrefix`/`mcpEndpoint` module option:

```typescript
const mcp = new McpStrategy({
  name: 'custom-endpoints-server',
  version: '0.0.1',
  transports: [
    new StreamableHttpTransport({ endpoint: '/api/v1/mcp-operations' }),
  ],
});
```

**Endpoints exposed:**

- `POST /api/v1/mcp-operations` - MCP operations

## Global Prefix Integration

MCP transports mount their routes directly on the HTTP adapter, so `app.setGlobalPrefix()` does not apply to them — there is no `apiPrefix` to coordinate. A global prefix on your normal Nest controllers and the MCP endpoints coexist without conflict:

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Affects your normal Nest controllers only; MCP routes are unaffected.
  app.setGlobalPrefix('/api');

  // MCP routes stay at the transport endpoints you configured (e.g. /mcp).
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(3030);
}
```

If you want the MCP routes under a prefix, set it explicitly on the transport constructors (e.g. `new StreamableHttpTransport({ endpoint: '/api/mcp' })`).

## Logging Configuration

Control the MCP logging behavior independently from your application's logging via the `logging` option on the `McpStrategy`:

### Disable All MCP Logging

Completely disable MCP logging (recommended for STDIO servers, where stdout carries the protocol):

```typescript
const mcp = new McpStrategy({
  name: 'quiet-mcp-server',
  version: '0.0.1',
  transports: [new StreamableHttpTransport()],
  logging: false, // Disables all MCP logging
});
```

### Filter Log Levels

Only show specific log levels:

```typescript
const mcp = new McpStrategy({
  name: 'filtered-mcp-server',
  version: '0.0.1',
  transports: [new StreamableHttpTransport()],
  logging: {
    level: ['error', 'warn'], // Only show errors and warnings
  },
});
```

### Available Log Levels

You can configure any combination of these log levels:

- `'log'` - General information
- `'error'` - Error messages
- `'warn'` - Warning messages
- `'debug'` - Debug information
- `'verbose'` - Detailed verbose output

### Default Behavior

When the `logging` option is not specified, the strategy uses standard NestJS logging and respects your application's global logger configuration.

### Use Cases

**Production environments:**
```typescript
logging: {
  level: ['error', 'warn'], // Only critical messages
}
```

**Development environments:**
```typescript
logging: {
  level: ['log', 'error', 'warn', 'debug'], // More detailed logs
}
```

**Testing/CI:**
```typescript
logging: false, // Reduce noise in test output
```

## Related

- [Tools](tools.md) - Define executable functions
- [Resources](resources.md) - Provide data sources
- [Prompts](prompts.md) - Create instruction templates
