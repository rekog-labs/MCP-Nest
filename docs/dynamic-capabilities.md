# Dynamic Capability Registration

Dynamic capability registration allows you to programmatically register MCP tools, resources, and prompts at runtime using the `McpDynamicCapabilityRegistryService`. This is useful when you need to:

- Load descriptions or parameters from a database
- Build plugin systems with runtime capability registration
- Create capabilities based on runtime configuration
- Generate capabilities from external API schemas

Dynamic capabilities work alongside decorator-based capabilities and support all the same features. Registering with an already-used name overwrites the previous entry (a warning is logged).

**Contents:**
  - [Quick Start](#quick-start)
  - [Tools](#tools)
    - [Loading from Database](#loading-from-database)
    - [Tool with Authorization](#tool-with-authorization)
  - [Resources](#resources)
  - [Prompts](#prompts)
  - [Deregistration](#deregistration)
  - [Mixed Mode: Static + Dynamic](#mixed-mode-static--dynamic)
  - [Playground Example](#playground-example)
  - [API Reference](#api-reference)

## Quick Start

Create a service that injects `McpDynamicCapabilityRegistryService` and implements `OnModuleInit`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { McpDynamicCapabilityRegistryService } from '@rekog/mcp-nest';

@Injectable()
export class DynamicCapabilitiesService implements OnModuleInit {
  constructor(private readonly registry: McpDynamicCapabilityRegistryService) {}

  onModuleInit() {
    this.registry.registerTool({ /* ... */ });
    this.registry.registerResource({ /* ... */ });
    this.registry.registerPrompt({ /* ... */ });
  }
}
```

Add your service to the module's providers — `McpDynamicCapabilityRegistryService` is already provided by `McpModule.forRoot()`:

```typescript
@Module({
  imports: [McpModule.forRoot({ name: 'my-server', version: '1.0.0' })],
  providers: [DynamicCapabilitiesService],
})
export class AppModule {}
```

## Tools

### Basic Registration

```typescript
import { z } from 'zod';

this.registry.registerTool({
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
    private readonly registry: McpDynamicCapabilityRegistryService,
    private readonly toolConfigRepo: ToolConfigRepository,
    private readonly searchService: SearchService,
  ) {}

  async onModuleInit() {
    const collections = await this.toolConfigRepo.findAllCollections();
    const collectionNames = collections.map(c => c.name).join(', ');

    this.registry.registerTool({
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

Dynamic tools support the same authorization options as decorator-based tools:

```typescript
// Public tool (no authentication required)
this.registry.registerTool({
  name: 'public-search',
  description: 'Public search endpoint',
  isPublic: true,
  handler: async () => {
    return { content: [{ type: 'text', text: 'Results...' }] };
  },
});

// Tool requiring specific scopes and roles
this.registry.registerTool({
  name: 'admin-operation',
  description: 'Administrative operation',
  requiredScopes: ['admin', 'write'],
  requiredRoles: ['admin'],
  handler: async (args, context, request) => {
    const user = request.user;
    return { content: [{ type: 'text', text: `Admin action by ${user.name}` }] };
  },
});
```

## Resources

Resources represent data that the LLM can read. Each resource is identified by a URI.

```typescript
this.registry.registerResource({
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

The handler receives the request params, context, and raw HTTP request — matching the decorator-based resource signature:

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

this.registry.registerPrompt({
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
this.registry.registerPrompt({
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
this.registry.removeTool('search-knowledge');
this.registry.removeResource('mcp://app-config');
this.registry.removePrompt('summarize');
```

Attempting to call, read, or get a removed capability returns a `MethodNotFound` MCP error.

Re-registering after removal works as expected — the capability reappears in listings and the new handler is used:

```typescript
this.registry.removeTool('my-tool');

// Later...
this.registry.registerTool({
  name: 'my-tool',
  description: 'Updated version',
  handler: async () => ({ content: [{ type: 'text', text: 'new result' }] }),
});
```

## Mixed Mode: Static + Dynamic

Dynamic capabilities work seamlessly alongside decorator-based ones:

```typescript
@Injectable()
export class StaticTools {
  @Tool({
    name: 'static-tool',
    description: 'A statically defined tool',
    parameters: z.object({ input: z.string() }),
  })
  staticTool({ input }: { input: string }) {
    return { content: [{ type: 'text', text: `Static: ${input}` }] };
  }
}

@Injectable()
export class DynamicCapabilitiesService implements OnModuleInit {
  constructor(private readonly registry: McpDynamicCapabilityRegistryService) {}

  onModuleInit() {
    this.registry.registerTool({
      name: 'dynamic-tool',
      description: 'A dynamically registered tool',
      handler: async () => ({ content: [{ type: 'text', text: 'Dynamic result' }] }),
    });
  }
}

@Module({
  imports: [McpModule.forRoot({ name: 'server', version: '1.0.0' })],
  providers: [StaticTools, DynamicCapabilitiesService],
})
export class AppModule {}
```

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

### McpDynamicCapabilityRegistryService

```typescript
class McpDynamicCapabilityRegistryService {
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
  context: Context,
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
  context: Context,
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
  context: Context,
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
