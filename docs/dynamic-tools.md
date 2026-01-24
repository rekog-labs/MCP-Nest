# Dynamic Tool Registration

Dynamic tool registration allows you to programmatically register MCP tools at runtime using the `McpToolBuilder` service. This is useful when you need to:

- Load tool descriptions or parameters from a database
- Build plugin systems with runtime tool registration
- Create tools based on runtime configuration
- Generate tools from external API schemas

Dynamic tools work alongside decorator-based tools and support all the same features including parameter validation, output schemas, authorization, and progress reporting.

**Contents:**
  - [Quick Start](#quick-start)
  - [Example: Loading from Database](#loading-from-database)
  - [Tool Definition](#tool-definition)
    - [DynamicToolDefinition Interface](#dynamictooldefinition-interface)
    - [Handler Function](#handler-function)
    - [Tool with Authorization](#tool-with-authorization)
  - [Mixed Mode: Static + Dynamic Tools](#mixed-mode-static--dynamic-tools)
  - [Playground Example](#playground-example)
  - [API Reference](#api-reference)
    - [McpToolBuilder](#mcptoolbuilder)
    - [Types](#types)

<!-- /TOC -->

## <a name='QuickStart'></a>Quick Start

### Step 1: <a name='InjectMcpToolBuilder'></a>Inject McpToolBuilder

Create a service that injects `McpToolBuilder` and implements `OnModuleInit`:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { McpToolBuilder } from '@rekog/mcp-nest';
import { z } from 'zod';

@Injectable()
export class DynamicToolsService implements OnModuleInit {
  constructor(private readonly toolBuilder: McpToolBuilder) {}

  async onModuleInit() {
    // Register tools here - runs before server starts
    this.toolBuilder.registerTool({
      name: 'search-knowledge',
      description: 'Search the knowledge base',
      parameters: z.object({
        query: z.string().describe('Search query'),
        limit: z.number().default(10),
      }),
      handler: async (args) => {
        // Tool implementation
        return {
          content: [{ type: 'text', text: `Results for: ${args.query}` }],
        };
      },
    });
  }
}
```

### Step 2: <a name='AddtoModuleProviders'></a>Add to Module Providers

Simply add your service to the module's providers:

```typescript
@Module({
  imports: [
    McpModule.forRoot({
      name: 'my-server',
      version: '1.0.0',
    }),
  ],
  providers: [DynamicToolsService], // McpToolBuilder is already available
})
export class AppModule {}
```

That's it! Your dynamic tools will be available alongside any decorator-based tools.

##  Example: <a name='LoadingfromDatabase'></a>Loading from Database

A common use case is loading tool configurations from a database:

```typescript
@Injectable()
export class DatabaseToolsService implements OnModuleInit {
  constructor(
    private readonly toolBuilder: McpToolBuilder,
    private readonly toolConfigRepo: ToolConfigRepository,
    private readonly searchService: SearchService,
  ) {}

  async onModuleInit() {
    // Fetch tool configuration from database
    const collections = await this.toolConfigRepo.findAllCollections();
    const collectionNames = collections.map(c => c.name).join(', ');

    // Register tool with dynamic description
    this.toolBuilder.registerTool({
      name: 'search-collection',
      description: `Search across collections. Available: ${collectionNames}`,
      parameters: z.object({
        query: z.string(),
        collection: z.enum(
          collections.map(c => c.name) as [string, ...string[]]
        ),
      }),
      handler: async (args) => {
        // Handler has access to all injected services via closure
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

## Example: <a name='ToolwithAuthorization'></a>Tool with Authorization

Dynamic tools support the same authorization options as decorator-based tools:

```typescript
// Public tool (no authentication required)
this.toolBuilder.registerTool({
  name: 'public-search',
  description: 'Public search endpoint',
  isPublic: true,
  handler: async (args) => {
    // Anyone can call this
    return { content: [{ type: 'text', text: 'Results...' }] };
  },
});

// Tool requiring specific scopes
this.toolBuilder.registerTool({
  name: 'admin-operation',
  description: 'Administrative operation',
  requiredScopes: ['admin', 'write'],
  requiredRoles: ['admin'],
  handler: async (args, context, request) => {
    // Only users with admin scope and admin role can call this
    const user = request.user;
    return { content: [{ type: 'text', text: `Admin action by ${user.name}` }] };
  },
});
```

##  Example: <a name='MixedMode:StaticDynamicTools'></a>Mixed Mode: Static + Dynamic Tools

Dynamic tools work seamlessly alongside decorator-based tools:

```typescript
// Decorator-based static tool
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

// Dynamic tools service
@Injectable()
export class DynamicTools implements OnModuleInit {
  constructor(private readonly toolBuilder: McpToolBuilder) {}

  onModuleInit() {
    this.toolBuilder.registerTool({
      name: 'dynamic-tool',
      description: 'A dynamically registered tool',
      handler: async (args) => {
        return { content: [{ type: 'text', text: 'Dynamic result' }] };
      },
    });
  }
}

// Both work together
@Module({
  imports: [McpModule.forRoot({ name: 'server', version: '1.0.0' })],
  providers: [StaticTools, DynamicTools],
})
export class AppModule {}
```

##  5. <a name='PlaygroundExample'></a>Playground Example

See [playground/servers/servers-with-dynamic-tools.ts](../playground/servers/servers-with-dynamic-tools.ts) for a complete working example demonstrating:

- Two MCP servers (one with static tools, one with static + dynamic)
- Database simulation for loading tool configurations
- Structured output schemas
- Progress reporting
- How to test with MCP Inspector

Run it with:

```bash
# Start the servers
npx ts-node-dev --respawn ./playground/servers/servers-with-dynamic-tools.ts

# Test Server 1 (static tools only)
bunx @modelcontextprotocol/inspector --cli "http://localhost:3031/mcp" --transport http --method tools/list

# Test Server 2 (static + dynamic tools)
bunx @modelcontextprotocol/inspector --cli "http://localhost:3032/mcp" --transport http --method tools/list
```

##  6. <a name='APIReference'></a>API Reference

###  6.1. <a name='McpToolBuilder'></a>McpToolBuilder

```typescript
class McpToolBuilder {
  /**
   * Register a dynamic tool for the current MCP server
   */
  registerTool(definition: DynamicToolDefinition): void;
}
```

###  6.2. <a name='Types'></a>Types

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

interface ToolAnnotations {
  title?: string;
  destructiveHint?: boolean;
  readOnlyHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
```
