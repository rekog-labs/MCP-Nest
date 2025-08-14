# Server Examples

This guide shows different ways to set up MCP servers using mcp-nest with various transport types and configurations.

## HTTP Server (Stateful)

The most common setup for web applications with session management:

```typescript
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { McpModule } from '@rekog/mcp-nest';
import { GreetingTool } from './greeting.tool';
import { GreetingResource } from './greeting.resource';
import { GreetingPrompt } from './greeting.prompt';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'playground-mcp-server',
      version: '0.0.1',
      streamableHttp: {
        enableJsonResponse: false,
        sessionIdGenerator: () => randomUUID(),
        statelessMode: false, // Enables session management
      },
    }),
  ],
  providers: [GreetingResource, GreetingTool, GreetingPrompt],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3030);
  console.log('MCP server started on port 3030');
}

void bootstrap();
```

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

## HTTP Server (Stateless)

Simpler setup without session management, good for REST-like usage:

```typescript
@Module({
  imports: [
    McpModule.forRoot({
      name: 'playground-mcp-server',
      version: '0.0.1',
      transport: McpTransportType.STREAMABLE_HTTP,
      streamableHttp: {
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
        statelessMode: true, // No session management
      },
    }),
  ],
  providers: [GreetingResource, GreetingTool, GreetingPrompt],
})
class AppModule {}
```

**Endpoints exposed:**

- `POST /mcp` - All MCP operations

**Run:**

```bash
npx ts-node-dev --respawn playground/servers/server-stateless.ts
```

## STDIO Server

For command-line tools and desktop applications:

```typescript
import { McpTransportType } from '@rekog/mcp-nest';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'playground-stdio-server',
      version: '0.0.1',
      transport: McpTransportType.STDIO,
    }),
  ],
  providers: [GreetingTool, GreetingPrompt, GreetingResource],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false, // Disable logging for STDIO
  });
  return app.close();
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

**By default, all three transport types are enabled** (SSE, Streamable HTTP, and STDIO). You can selectively enable only specific transports by providing the `transport` array:

```typescript
@Module({
  imports: [
    McpModule.forRoot({
      name: 'multi-transport-server',
      version: '0.0.1',
      transport: [
        McpTransportType.SSE,
        McpTransportType.STREAMABLE_HTTP,
        // McpTransportType.STDIO // Uncomment to enable STDIO
      ],
    }),
  ],
  providers: [GreetingTool],
})
class AppModule {}
```

**Endpoints exposed:**

- `GET /sse` - SSE connection
- `POST /messages` - Tool execution (SSE transport)
- `POST /mcp` - Streamable HTTP operations

## Server with Authentication

Add guards for secured endpoints:

```typescript
import { AuthGuard } from './auth.guard';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'secure-mcp-server',
      version: '0.0.1',
      guards: [AuthGuard], // Protect all MCP endpoints
    }),
  ],
  providers: [GreetingTool, AuthGuard],
})
class AppModule {}
```

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
    McpModule.forRoot({
      name: 'secure-mcp-server',
      version: '0.0.1',
      guards: [McpAuthJwtGuard],
    }),
  ],
  providers: [GreetingTool, McpAuthJwtGuard],
})
class AppModule {}
```

## Custom Endpoints

Customize endpoint paths:

```typescript
@Module({
  imports: [
    McpModule.forRoot({
      name: 'custom-endpoints-server',
      version: '0.0.1',
      apiPrefix: 'api/v1',
      sseEndpoint: 'events',
      messagesEndpoint: 'chat',
      mcpEndpoint: 'mcp-operations',
    }),
  ],
  providers: [GreetingTool],
})
class AppModule {}
```

**Endpoints exposed:**

- `GET /api/v1/events` - SSE connection
- `POST /api/v1/chat` - Messages
- `POST /api/v1/mcp-operations` - MCP operations

## Fastify Server

Using Fastify instead of Express:

```typescript
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  await app.listen(3030, '0.0.0.0');
  console.log('Fastify MCP server started on port 3030');
}
```

**Run:**

```bash
npx ts-node-dev --respawn playground/servers/server-stateful-fastify.ts
```

## Global Prefix Integration

Exclude MCP endpoints from global prefixes:

```typescript
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Apply global prefix but exclude MCP endpoints
  app.setGlobalPrefix('/api', {
    exclude: ['sse', 'messages', 'mcp']
  });

  await app.listen(3030);
}
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

## Example Locations

Complete examples can be found in:

- `playground/servers/server-stateful.ts` - Stateful HTTP server
- `playground/servers/server-stateless.ts` - Stateless HTTP server
- `playground/servers/stdio.ts` - STDIO server
- `playground/servers/server-stateful-fastify.ts` - Fastify server
- `playground/servers/server-stateful-oauth.ts` - Server with OAuth

## Related

- [Tools](tools.md) - Define executable functions
- [Resources](resources.md) - Provide data sources
- [Prompts](prompts.md) - Create instruction templates
