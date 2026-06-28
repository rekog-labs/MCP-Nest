# Dynamic Capability Registration

Dynamic capability registration allows you to programmatically register MCP tools, resources, and prompts at runtime directly on the `McpStrategy` instance. This is useful when you need to:

- Load descriptions or parameters from a database
- Build plugin systems with runtime capability registration
- Create capabilities based on runtime configuration
- Generate capabilities from external API schemas

Dynamic capabilities work alongside decorator-based capabilities. Registering with an already-used name overwrites the previous entry.

> **Note:** Dynamically registered handlers are invoked **directly** by the strategy — they do **not** pass through the NestJS RPC pipeline, so guards, pipes, interceptors, and exception filters do not apply to them. Use `@McpController` classes when you need the pipeline; use dynamic registration for runtime-defined capabilities.

**Contents:**
  - [Quick Start](#quick-start)
  - [Tools](#tools)
    - [Loading from Database](#loading-from-database)
    - [Tool with Authorization](#tool-with-authorization)
  - [Resources](#resources)
  - [Prompts](#prompts)
  - [Deregistration](#deregistration)
  - [Mixed Mode: Static + Dynamic](#mixed-mode-static--dynamic)
  - [Registration from an External Module](#registration-from-an-external-module)
    - [Multi-Server Isolation](#multi-server-isolation)
  - [Playground Example](#playground-example)
  - [API Reference](#api-reference)

## Quick Start

Inject the strategy via the `MCP_STRATEGY` token and register capabilities in a lifecycle hook such as `OnModuleInit` or `OnApplicationBootstrap`:

```typescript
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { MCP_STRATEGY, McpStrategy } from '@rekog/mcp-nest';

@Injectable()
export class DynamicCapabilitiesService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({ /* ... */ });
    this.strategy.registerResource({ /* ... */ });
    this.strategy.registerPrompt({ /* ... */ });
  }
}
```

Wire the strategy under the `MCP_STRATEGY` token in the module that owns the
strategy, and add your service to the same module's providers:

```typescript
import { Module } from '@nestjs/common';
import {
  MCP_STRATEGY,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';

export const mcp = new McpStrategy({
  name: 'my-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport()],
});

@Module({
  providers: [
    { provide: MCP_STRATEGY, useValue: mcp },
    DynamicCapabilitiesService,
  ],
})
export class AppModule {}
```

Remember to wire the strategy into your bootstrap:

```typescript
const app = await NestFactory.create(AppModule);
mcp.setHttpAdapter(app.getHttpAdapter());
app.connectMicroservice({ strategy: mcp });
await app.startAllMicroservices();
await app.listen(3000);
```

## Tools

### Basic Registration

```typescript
import { z } from 'zod';

this.strategy.registerTool({
  name: 'search-knowledge',
  description: 'Search the knowledge base',
  parameters: z.object({
    query: z.string().describe('Search query'),
    limit: z.number().default(10),
  }),
  handler: async (args) => {
    return {
      content: [{ type: 'text', text: `Results for: ${args.query}` }],
    };
  },
});
```

### Loading from Database

A common pattern is loading tool configurations from a database at startup:

```typescript
@Injectable()
export class DatabaseToolsService implements OnModuleInit {
  constructor(
    @Inject(MCP_STRATEGY) private readonly strategy: McpStrategy,
    private readonly toolConfigRepo: ToolConfigRepository,
    private readonly searchService: SearchService,
  ) {}

  async onModuleInit() {
    const collections = await this.toolConfigRepo.findAllCollections();
    const collectionNames = collections.map(c => c.name).join(', ');

    this.strategy.registerTool({
      name: 'search-collection',
      description: `Search across collections. Available: ${collectionNames}`,
      parameters: z.object({
        query: z.string(),
        collection: z.enum(collections.map(c => c.name) as [string, ...string[]]),
      }),
      handler: async (args) => {
        const results = await this.searchService.search(
          args.query as string,
          args.collection as string,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(results) }],
        };
      },
    });
  }
}
```

### Tool with Authorization

Dynamic tools support the same authorization metadata as decorator-based tools.
The handler receives the raw HTTP request as its third argument, where the
authentication middleware sets `request.user` (see
[Per-Tool Authorization](per-tool-authorization.md)):

```typescript
// Public tool (no authentication required)
this.strategy.registerTool({
  name: 'public-search',
  description: 'Public search endpoint',
  isPublic: true,
  handler: async () => {
    return { content: [{ type: 'text', text: 'Results...' }] };
  },
});

// Tool requiring specific scopes and roles
this.strategy.registerTool({
  name: 'admin-operation',
  description: 'Administrative operation',
  requiredScopes: ['admin', 'write'],
  requiredRoles: ['admin'],
  handler: async (args, context, request) => {
    const user = request?.user;
    return { content: [{ type: 'text', text: `Admin action by ${user.name}` }] };
  },
});
```

## Resources

Resources represent data that the LLM can read. Each resource is identified by a URI.

```typescript
this.strategy.registerResource({
  uri: 'mcp://app-config',
  name: 'app-config',
  description: 'Application configuration',
  mimeType: 'application/json',
  handler: async () => {
    return {
      contents: [
        {
          uri: 'mcp://app-config',
          mimeType: 'application/json',
          text: JSON.stringify({ env: 'production', version: '2.0.0' }),
        },
      ],
    };
  },
});
```

The handler receives the request params, the `McpContext`, and the raw HTTP request — matching the decorator-based resource signature:

```typescript
handler: async (params, context, request) => {
  // params includes the requested uri and any matched path parameters
  return {
    contents: [{ uri: params.uri as string, mimeType: 'text/plain', text: 'content' }],
  };
};
```

## Prompts

Prompts are reusable message templates. They can define Zod schemas for their arguments.

```typescript
import { z } from 'zod';

this.strategy.registerPrompt({
  name: 'summarize',
  description: 'Summarize the provided text',
  parameters: z.object({
    text: z.string().describe('The text to summarize'),
    style: z.enum(['brief', 'detailed']).optional(),
  }),
  handler: async (args) => {
    return {
      description: 'Summarize the provided text',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please summarize in ${args?.style ?? 'brief'} style:\n\n${args?.text}`,
          },
        },
      ],
    };
  },
});
```

Prompts without parameters omit the `parameters` field:

```typescript
this.strategy.registerPrompt({
  name: 'greeting',
  description: 'A simple greeting prompt',
  handler: async () => ({
    description: 'A simple greeting prompt',
    messages: [{ role: 'user', content: { type: 'text', text: 'Hello!' } }],
  }),
});
```

## Deregistration

Capabilities can be removed at any time, including while the server is running. The next `list` request will reflect the change immediately.

```typescript
this.strategy.removeTool('search-knowledge');
this.strategy.removeResource('mcp://app-config');
this.strategy.removePrompt('summarize');
```

Attempting to call, read, or get a removed capability returns a `MethodNotFound` MCP error.

Re-registering after removal works as expected — the capability reappears in listings and the new handler is used:

```typescript
this.strategy.removeTool('my-tool');

// Later...
this.strategy.registerTool({
  name: 'my-tool',
  description: 'Updated version',
  handler: async () => ({ content: [{ type: 'text', text: 'new result' }] }),
});
```

## Mixed Mode: Static + Dynamic

Dynamic capabilities work seamlessly alongside decorator-based ones. Static
tools live on `@McpController` classes (listed in a module's `controllers`),
while dynamic tools are registered on the strategy:

```typescript
import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';

@McpController()
export class StaticTools {
  @Tool({
    name: 'static-tool',
    description: 'A statically defined tool',
    parameters: z.object({ input: z.string() }),
  })
  staticTool(@Payload() { input }: { input: string }) {
    return { content: [{ type: 'text', text: `Static: ${input}` }] };
  }
}

@Injectable()
export class DynamicCapabilitiesService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'dynamic-tool',
      description: 'A dynamically registered tool',
      handler: async () => ({ content: [{ type: 'text', text: 'Dynamic result' }] }),
    });
  }
}

@Module({
  controllers: [StaticTools],
  providers: [
    { provide: MCP_STRATEGY, useValue: mcp },
    DynamicCapabilitiesService,
  ],
})
export class AppModule {}
```

## Registration from an External Module

In larger applications the service that registers dynamic capabilities will
often live in a separate NestJS module from the one that hosts the MCP server.
Because the strategy is a plain object wired under the `MCP_STRATEGY` token,
expose it from a shared module and import that module wherever you need to
register capabilities.

```
AppModule
├── ServerModule ──provides──► { provide: MCP_STRATEGY, useValue: mcp }
│        └── exports: [MCP_STRATEGY]
└── ExternalModule ──imports──► ServerModule
         └── providers: [ExternalCapabilitiesService]
```

**ServerModule** — owns the strategy instance and exports the `MCP_STRATEGY`
token so importers can inject it:

```typescript
import { Module } from '@nestjs/common';
import {
  MCP_STRATEGY,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';

export const mcp = new McpStrategy({
  name: 'my-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport()],
});

@Module({
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
  exports: [MCP_STRATEGY],
})
export class ServerModule {}
```

**ExternalModule** — imports `ServerModule` to inject the strategy and registers
capabilities in its own providers:

```typescript
import { Inject, Injectable, Module, OnModuleInit } from '@nestjs/common';
import { MCP_STRATEGY, McpStrategy } from '@rekog/mcp-nest';
import { ServerModule } from './server.module';

@Injectable()
export class ExternalCapabilitiesService implements OnModuleInit {
  constructor(@Inject(MCP_STRATEGY) private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'external-tool',
      description: 'A tool registered from an external module',
      handler: async () => ({
        content: [{ type: 'text', text: 'result' }],
      }),
    });
  }
}

@Module({
  imports: [ServerModule],
  providers: [ExternalCapabilitiesService],
})
export class ExternalModule {}
```

**AppModule** — imports both:

```typescript
@Module({
  imports: [ServerModule, ExternalModule],
})
export class AppModule {}
```

Because NestJS shares the singleton bound to `MCP_STRATEGY` across the module
graph, `ExternalCapabilitiesService` receives the exact same `McpStrategy`
instance that serves the HTTP endpoints. Capabilities registered there appear
immediately in `tools/list`, `resources/list`, and `prompts/list` responses.

### Multi-Server Isolation

> This section covers **dynamically registered** tools. For **decorator**
> (`@Tool`) tools, isolation comes from named servers
> (`@McpController({ server })` + `McpStrategy({ server })`) — see
> [Multiple MCP Servers](./multiple-servers.md).

When running multiple MCP servers in one application, construct one
`McpStrategy` per server (each with its own transports/endpoints) and connect
each as a separate microservice. Each strategy owns its own dynamic registry, so
a tool registered on `mcpServerA` is only visible on server A. Wire each
strategy under a distinct token (or distinct module) and inject the right one.

```typescript
const mcpServerA = new McpStrategy({
  name: 'server-a',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ endpoint: '/server-a/mcp' })],
});
const mcpServerB = new McpStrategy({
  name: 'server-b',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ endpoint: '/server-b/mcp' })],
});

@Injectable()
export class ServerAExternalTools implements OnModuleInit {
  constructor(private readonly strategy: McpStrategy) {}

  onModuleInit() {
    this.strategy.registerTool({
      name: 'server-a-tool',
      description: 'Only visible on server A',
      handler: async () => ({ content: [{ type: 'text', text: 'server-a' }] }),
    });
  }
}
```

Connect both with `app.connectMicroservice({ strategy: mcpServerA })` and
`app.connectMicroservice({ strategy: mcpServerB })`. `server-a-tool` will appear
only in `/server-a/mcp` tool listings — `/server-b/mcp` remains unaffected.

## Playground Example

See [playground/servers/servers-with-dynamic-tools.ts](../playground/servers/servers-with-dynamic-tools.ts) for a complete working example.

Run it with:

```bash
npx ts-node-dev --respawn ./playground/servers/servers-with-dynamic-tools.ts

# Test Server 1 (static tools only)
bunx @modelcontextprotocol/inspector --cli "http://localhost:3031/mcp" --transport http --method tools/list

# Test Server 2 (static + dynamic tools)
bunx @modelcontextprotocol/inspector --cli "http://localhost:3032/mcp" --transport http --method tools/list
```

## API Reference

### McpStrategy (registration methods)

```typescript
class McpStrategy {
  registerTool(definition: DynamicToolDefinition): void;
  removeTool(name: string): void;

  registerResource(definition: DynamicResourceDefinition): void;
  removeResource(uri: string): void;

  registerPrompt(definition: DynamicPromptDefinition): void;
  removePrompt(name: string): void;
}
```

### Types

```typescript
interface DynamicToolDefinition {
  name: string;
  description: string;
  parameters?: z.ZodType;
  outputSchema?: z.ZodType;
  annotations?: ToolAnnotations;
  _meta?: Record<string, any>;
  handler: DynamicToolHandler;
  isPublic?: boolean;
  requiredScopes?: string[];
  requiredRoles?: string[];
}

type DynamicToolHandler = (
  args: Record<string, unknown>,
  context: McpContext,
  request: any,
) => Promise<any> | any;

interface DynamicResourceDefinition {
  uri: string;
  name?: string;
  description?: string;
  mimeType?: string;
  _meta?: Record<string, any>;
  handler: DynamicResourceHandler;
}

type DynamicResourceHandler = (
  params: Record<string, unknown>,
  context: McpContext,
  request: any,
) => Promise<any> | any;

interface DynamicPromptDefinition {
  name: string;
  description: string;
  parameters?: ZodObject<PromptArgsRawShape>;
  handler: DynamicPromptHandler;
}

type DynamicPromptHandler = (
  args: Record<string, string> | undefined,
  context: McpContext,
  request: any,
) => Promise<any> | any;

interface ToolAnnotations {
  title?: string;
  destructiveHint?: boolean;
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
```
