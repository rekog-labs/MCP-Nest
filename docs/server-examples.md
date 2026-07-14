# Server Examples

This guide walks through different ways to set up MCP servers using mcp-nest with various transport types and configurations. Each pattern below links to its explanation in this document and to a runnable example in the playground:

- [Stateful MCP Server](#stateful-mcp-server) — [`server-stateful.ts`](../playground/servers/server-stateful.ts)
- [Stateless MCP Server](#stateless-mcp-server) — [`server-stateless.ts`](../playground/servers/server-stateless.ts)
- [STDIO MCP Server](#stdio-server) — [`stdio.ts`](../playground/servers/stdio.ts)
- [Fastify Adapter](#fastify-server) — [`server-stateful-fastify.ts`](../playground/servers/server-stateful-fastify.ts)
- [OAuth Authentication](#server-with-authentication) — [`server-oauth.ts`](../playground/servers/server-oauth.ts)
- [Custom Controllers](#custom-controllers) — [`custom-controllers/server.ts`](../playground/servers/custom-controllers/server.ts)
- [Async Configuration](#async-configuration-forrootasync) — [`server-stateless-async.ts`](../playground/servers/server-stateless-async.ts)
- [Multiple Transports](#multiple-transport-types)
- [Custom Endpoints](#custom-endpoints)
- [Global Prefix Integration](#global-prefix-integration)

## Stateful MCP Server

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

## Stateless MCP Server

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

## Custom Controllers

For maximum control over your MCP endpoints, you can disable automatic controller generation and inject `McpStreamableHttpService` directly into your own controller:

```typescript
@Module({
  imports: [
    McpModule.forRoot({
      name: 'custom-controllers-server',
      version: '1.0.0',
      transport: [], // Disable automatic controllers
    }),
  ],
  controllers: [CustomStreamableController],
  providers: [GreetingTool],
})
class AppModule {}
```

And the controller would be similar to:

```typescript
@Controller()
export class CustomStreamableController {
  constructor(private readonly mcpStreamableHttpService: McpStreamableHttpService) {}

  @Post('/mcp')
  async handlePostRequest(
    @Req() req: any,
    @Res() res: any,
    @Body() body: unknown,
  ): Promise<void> {
    await this.mcpStreamableHttpService.handlePostRequest(req, res, body);
  }

  // additional endpoints ...
}
```

This pattern allows you to:
- Apply custom guards, interceptors, and middleware
- Define custom endpoint paths and routing
- Have fine-grained control over request/response handling

**See:** [Custom Controllers Guide](../playground/servers/custom-controllers/README.md) for a full implementation.

### Async Configuration (`forRootAsync`)

Async configuration is possible only with [Custom Controllers](#custom-controllers), which is a hard requirement.

```typescript
// reminder: forRootAsync disables controller auto wiring and you need to create custom controllers
McpModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    name: config.get('MCP_NAME', 'async-mcp-server'),
    version: config.get('MCP_VERSION', '0.0.1'),
  }),
})
```

Working example: [`playground/servers/server-stateless-async.ts`](../playground/servers/server-stateless-async.ts).


## Custom Endpoints

You can customize endpoint paths as shown below, however, it is recommended to use [Custom Controllers](#custom-controllers) and take full control over your endpoints:

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

## Logging Configuration

Control the logging behavior of the MCP module independently from your application's logging:

### Disable All MCP Logging

Completely disable logging from the MCP module:

```typescript
@Module({
  imports: [
    McpModule.forRoot({
      name: 'quiet-mcp-server',
      version: '0.0.1',
      logging: false, // Disables all MCP module logging
    }),
  ],
  providers: [GreetingTool],
})
class AppModule {}
```

### Filter Log Levels

Only show specific log levels from the MCP module:

```typescript
@Module({
  imports: [
    McpModule.forRoot({
      name: 'filtered-mcp-server',
      version: '0.0.1',
      logging: {
        level: ['error', 'warn'], // Only show errors and warnings
      },
    }),
  ],
  providers: [GreetingTool],
})
class AppModule {}
```

### Available Log Levels

You can configure any combination of these log levels:

- `'log'` - General information
- `'error'` - Error messages
- `'warn'` - Warning messages
- `'debug'` - Debug information
- `'verbose'` - Detailed verbose output

### Default Behavior

When the `logging` option is not specified, the MCP module uses standard NestJS logging and respects your application's global logger configuration.

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
