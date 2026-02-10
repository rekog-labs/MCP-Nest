# Tools

Tools are functions that AI agents can execute to perform actions or computations. In mcp-nest, tools are defined using the `@Tool()` decorator on service methods.

## Basic Tool

```typescript
import type { Request } from 'express';
import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';

@Injectable()
export class GreetingTool {
  @Tool({
    name: 'greet-user',
    description: "Returns a personalized greeting in the user's preferred language",
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      language: z.string().describe('Language code (e.g., "en", "es", "fr")'),
    }),
  })
  async sayHello({ name, language }, context: Context, request: Request) {
    const greetings = {
      en: 'Hey',
      es: 'Qué tal',
      fr: 'Salut',
    };

    const greeting = greetings[language] || greetings.en;
    return `${greeting}, ${name}!`;
  }
}
```

### Understanding Tool Method Parameters

Every tool method receives exactly **three parameters** in this order:

1. **`args`** (first parameter): The validated input parameters as defined by the `parameters` Zod schema in the `@Tool` decorator.

2. **`context: Context`** (second parameter): The MCP execution context providing access to:
   - `reportProgress()` - Method to report progress updates to the client
   - `mcpServer` - Access to the underlying MCP server instance for advanced operations like elicitation
   - `mcpRequest` - The MCP request object
   - Logging capabilities and other contextual information

3. **`request: Request`** (third parameter): The original HTTP request object (Express/Fastify), providing access to headers, query parameters, authentication data, and other HTTP-specific information. This parameter is `undefined` when using STDIO transport.

### Tool Decorator Properties

The `@Tool()` decorator accepts a configuration object with the following properties:

- **`name`** (required): Unique identifier for the tool within your MCP server
- **`description`** (required): Human-readable description explaining what the tool does
- **`parameters`** (required): Zod schema defining the expected input parameters and their validation rules
- **`outputSchema`** (optional): Zod schema for validating and structuring the tool's return value
- **`annotations`** (optional): Metadata hints for AI agents, including:
  - `readOnlyHint`: Indicates if the tool only reads data without side effects
  - `destructiveHint`: Warns if the tool modifies or deletes data
  - `idempotentHint`: Indicates if repeated calls with same input produce same output
  - `openWorldHint`: Suggests if the tool's behavior is predictable or may vary

For detailed type definitions, refer to the `Context` interface and `ToolOptions` type in the `@rekog/mcp-nest` package.

## Tool with Progress Reporting

```typescript
@Tool({
  name: 'process-data',
  description: 'Processes data with progress updates',
  parameters: z.object({
    data: z.string(),
  }),
})
async processData({ data }, context: Context) {
  const totalSteps = 5;

  for (let i = 0; i < totalSteps; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));

    // Report progress to the client
    await context.reportProgress({
      progress: (i + 1) * 20,
      total: 100,
    });
  }

  return `Processed: ${data}`;
}
```

## Tool with Output Schema

Tools can define structured output schemas for type safety:

```typescript
@Tool({
  name: 'greet-user-structured',
  description: 'Returns a structured greeting with metadata',
  parameters: z.object({
    name: z.string(),
    language: z.string(),
  }),
  outputSchema: z.object({
    greeting: z.string(),
    language: z.string(),
    languageName: z.string(),
  }),
})
async sayHelloStructured({ name, language }) {
  return {
    greeting: `Hey, ${name}!`,
    language,
    languageName: 'English',
  };
}
```

## Interactive Tool with Elicitation

Tools can request additional input from users:

```typescript
@Tool({
  name: 'greet-user-interactive',
  description: 'Interactive greeting with language selection',
  parameters: z.object({
    name: z.string(),
  }),
})
async sayHelloInteractive({ name }, context: Context) {
  const response = await context.mcpServer.server.elicitInput({
    message: 'Please select your preferred language',
    requestedSchema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['en', 'es', 'fr', 'de'],
          description: 'Your preferred language',
        },
      },
    },
  });

  const selectedLanguage = response.action === 'accept'
    ? response.content.language
    : 'en';

  return `Hello, ${name}! (in ${selectedLanguage})`;
}
```

## Testing Your Tools

### 1. Start the Server

Run the playground server:

```bash
npx ts-node-dev --respawn playground/servers/server-stateful.ts
```

### 2. List Available Tools

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method tools/list
```

Expected output:

```json
{
  "tools": [
    {
      "name": "greet-user",
      "description": "Returns a personalized greeting in the user's preferred language",
      "inputSchema": {
        "type": "object",
        "properties": {
          "name": {
            "type": "string",
            "description": "The name of the person to greet"
          },
          "language": {
            "type": "string",
            "description": "Language code (e.g., \"en\", \"es\", \"fr\", \"de\")"
          }
        },
        "required": ["name", "language"]
      }
    }
  ]
}
```

### 3. Call a Tool

**Basic tool call:**

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method tools/call --tool-name greet-user --tool-arg name=Alice --tool-arg language=es
```

Expected output:

```json
{
  "content": [
    {
      "type": "text",
      "text": "\"Qué tal, Alice!\""
    }
  ]
}
```

**Interactive tool call:**

Interactive tool calls, use elicitation to get additional input from users. The **MCP Inspector CLI currently doesn't support elicitation**, but as soon as this [GitHub issue](https://github.com/modelcontextprotocol/inspector/issues/524) is resolved, you can test it with the command below. **In the meantime, you can test it using the MCP Inspector UI.**

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method tools/call --tool-name greet-user-interactive --tool-arg name=Bob
```

Elicited input:

```text
language: en
```

Expected output:

```json
{
  "content": [
    {
      "type": "text",
      "text": "Hey, Bob!"
    }
  ]
}
```

**Structured tool call (with output schema):**

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method tools/call --tool-name greet-user-structured --tool-arg name=Charlie --tool-arg language=fr
```

Expected output:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"greeting\": \"Salut, Charlie!\",\n  \"language\": \"fr\",\n  \"languageName\": \"French\"\n}"
    }
  ],
  "structuredContent": {
    "greeting": "Salut, Charlie!",
    "language": "fr",
    "languageName": "French"
  }
}
```

### 4. Interactive Testing

For interactive testing with progress updates, use the MCP Inspector UI:

```bash
npx @modelcontextprotocol/inspector@0.16.2
```

Connect to `http://localhost:3030/mcp` to test your tools interactively and see progress reporting in real-time.

## Tool Guards

Tools can be protected with NestJS guards for access control. When guards are specified, tools are:
- **Hidden** from `tools/list` for unauthorized users.
- **Blocked** from execution with "Access denied" error.

```typescript
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Tool, ToolGuards } from '@rekog/mcp-nest';
import { z } from 'zod';

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    return request?.user?.role === 'admin';
  }
}

@Injectable()
export class MyTools {
  @Tool({
    name: 'admin-action',
    description: 'Only visible and executable by admins',
    parameters: z.object({ target: z.string() }),
  })
  @ToolGuards([AdminGuard])
  async adminAction({ target }) {
    return { content: [{ type: 'text', text: `Admin action on ${target}` }] };
  }

  @Tool({
    name: 'secure-action',
    description: 'Requires both authentication and admin role',
    parameters: z.object({}),
  })
  @ToolGuards([AuthGuard, AdminGuard])
  async secureAction() {
    return { content: [{ type: 'text', text: 'Secure action complete' }] };
  }
}
```

`@ToolGuards()` can be combined with `@PublicTool()`, `@ToolScopes()`, and `@ToolRoles()`. JWT-based authorization checks run first, then guards are evaluated.

Multiple guards use AND logic: all guards must pass for access to be granted.

Guards require HTTP context and are not supported with STDIO transport. 
Tools with `@ToolGuards()` will be hidden when using STDIO.

## Example Location

See the complete example at: `playground/resources/greeting.tool.ts`
