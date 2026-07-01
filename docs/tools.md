# Tools

Tools are functions that AI agents can execute to perform actions or computations. In mcp-nest, tools are defined using the `@Tool()` decorator on `@McpController()` methods. Each tool becomes a real NestJS `@MessagePattern` handler, so guards, pipes, interceptors, and exception filters apply to it natively.

## Basic Tool

```typescript
import { McpController, Tool, McpContext } from '@rekog/mcp-nest';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class GreetingTool {
  @Tool({
    name: 'greet-user',
    description: "Returns a personalized greeting in the user's preferred language",
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      language: z.string().describe('Language code (e.g., "en", "es", "fr")'),
    }),
  })
  async sayHello(
    @Payload() { name, language }: { name: string; language: string },
    @Ctx() ctx: McpContext,
  ) {
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

Register the class in a module's `controllers` array (not `providers`) so NestJS scans it when the strategy is connected. See [Server Examples](server-examples.md) for the full bootstrap.

### Understanding Tool Method Parameters

Tool methods are RPC handlers, so their parameters are bound with `@nestjs/microservices` decorators:

1. **`@Payload() args`**: The validated input parameters as defined by the `parameters` Zod schema in the `@Tool` decorator. The first parameter defaults to the payload, so a handler that only needs its arguments can keep a single (optionally `@Payload()`-decorated) param.

2. **`@Ctx() ctx: McpContext`**: The MCP execution context providing access to:
   - `reportProgress()` - Method to report progress updates to the client (session-aware transports only)
   - `mcpServer` - Access to the underlying MCP server instance for advanced operations like elicitation
   - `mcpRequest` - The parsed JSON-RPC request
   - `log` - server-side logging
   - `getSession()` - `{ transport, stateless, sessionId }`
   - `getRawRequest()` - The original HTTP request object (Express/Fastify), providing access to headers, query parameters, authentication data, and other HTTP-specific information. This returns `undefined` when using STDIO transport.

3. **`@McpRawRequest() req`**: Injects the raw transport request directly — the MCP analog of NestJS's `@Req()`. This is sugar for `ctx.getRawRequest()`; reach for it when the request is all you need from the context, so you don't have to take `@Ctx()` just to call `getRawRequest()`. Like `getRawRequest()`, it is `undefined` under STDIO. The decorator does not type the value — annotate the parameter with your framework's request type (e.g. `@McpRawRequest() req?: Request`). This is the **HTTP transport** request (headers, cookies, `req.user`) — not to be confused with `ctx.mcpRequest`, which is the MCP **protocol** message; see [Reading the JSON-RPC request](#reading-the-json-rpc-request-ctxmcprequest).

> **Note:** When you use `@Ctx()` (or any other param decorator such as `@McpRawRequest()`), you must also annotate the data param with `@Payload()`. The old third positional `request` parameter is now read via `ctx.getRawRequest()` or injected with `@McpRawRequest()`.

### Reading the JSON-RPC request (`ctx.mcpRequest`)

`ctx.mcpRequest` is the parsed JSON-RPC request that triggered the handler — a `tools/call`, `resources/read`, or `prompts/get` request with its `method` and `params`. Use it to read protocol-level metadata that isn't part of your Zod-validated arguments, such as the client `_meta` (e.g. the `progressToken`).

> **Not to be confused with `@McpRawRequest()`.** `ctx.mcpRequest` is the MCP **protocol** message (the JSON-RPC request — always present, even over STDIO). `@McpRawRequest()` / `ctx.getRawRequest()` is the **HTTP transport** request (the Express/Fastify object carrying headers, cookies, and `req.user` — `undefined` over STDIO).

```typescript
@Tool({
  name: 'inspect-request',
  description: 'Reads the parsed JSON-RPC request',
  parameters: z.object({ input: z.string() }),
})
async inspectRequest(@Payload() { input }: { input: string }, @Ctx() ctx: McpContext) {
  // e.g. { method: 'tools/call', params: { name, arguments, _meta } }
  const method = ctx.mcpRequest.method;
  const progressToken = ctx.mcpRequest.params?._meta?.progressToken;
  return `method=${method}, progressToken=${progressToken ?? 'none'}`;
}
```

### Server-side logging (`ctx.log`)

`ctx.log` sends MCP logging messages to the client. It exposes `debug`, `info`, `warn`, and `error`, each taking a message and optional serializable data:

```typescript
@Tool({
  name: 'log-demo',
  description: 'Emits log messages while running',
  parameters: z.object({ input: z.string() }),
})
async logDemo(@Payload() { input }: { input: string }, @Ctx() ctx: McpContext) {
  ctx.log.info('Handling request', { input });
  ctx.log.debug('Low-level detail');
  ctx.log.warn('Heads up');
  ctx.log.error('Something went wrong');
  return `Processed: ${input}`;
}
```

For the client to actually receive these messages, the strategy must **declare the logging capability** — otherwise the server never advertises it and the `notifications/message` frames are dropped:

```typescript
new McpStrategy({
  name: 'my-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ statefulMode: true })],
  capabilities: { logging: {} }, // required for ctx.log.* to reach the client
});
```

Logging is also session-aware. On session-aware transports (stateful streamable HTTP and STDIO) the messages are pushed to the client — over the standing `GET` SSE stream, not the per-call `POST` response. On **stateless** streamable HTTP (the default `new StreamableHttpTransport()`), the server can't push to the client, so each `ctx.log.*` call is a no-op that emits a local NestJS warning instead — the same limitation applies to `ctx.reportProgress()`. (`warn` is sent at MCP level `warning`.)

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
- **`_meta`** (optional): Arbitrary metadata (`Record<string, any>`) passed straight through to the advertised tool definition. Your keys surface verbatim under `_meta` on the tool in `tools/list` and are not interpreted by the server. Note that the server merges its own keys into the same `_meta` object — every tool also carries a computed `securitySchemes` entry (derived from `@PublicTool`/`@ToolScopes`/`@ToolRoles`, or `[{ "type": "noauth" }]` when undecorated) — so `_meta` is your object plus those framework additions, not your object alone.

For detailed type definitions, refer to the `McpContext` interface and `ToolOptions` type in the `@rekog/mcp-nest` package.

### Tool with `_meta`

```typescript
@Tool({
  name: 'greet-user-meta',
  description: 'Greeting whose definition carries extra metadata',
  parameters: z.object({ name: z.string() }),
  // Arbitrary passthrough metadata; advertised verbatim as `_meta` in tools/list.
  _meta: {
    'example.com/category': 'greeting',
    'example.com/version': 2,
  },
})
async sayHelloMeta(@Payload() { name }: { name: string }) {
  return `Hey, ${name}!`;
}
```

## Tool with Progress Reporting

```typescript
@Tool({
  name: 'process-data',
  description: 'Processes data with progress updates',
  parameters: z.object({
    data: z.string(),
  }),
})
async processData(@Payload() { data }: { data: string }, @Ctx() ctx: McpContext) {
  const totalSteps = 5;

  for (let i = 0; i < totalSteps; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));

    // Report progress to the client
    await ctx.reportProgress({
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
async sayHelloStructured(@Payload() { name, language }: { name: string; language: string }) {
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
async sayHelloInteractive(@Payload() { name }: { name: string }, @Ctx() ctx: McpContext) {
  const response = await ctx.mcpServer.server.elicitInput({
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

## Exception Handling with @UseFilters

NestJS's `@UseFilters` and `@Catch` decorators work out of the box for tools, resources, and prompts. This allows you to create custom exception filters to handle errors consistently across your MCP server.

> **Behavioral note:** An unexpected error thrown inside a tool/resource/prompt handler is masked by NestJS's RPC pipeline to a generic "Internal server error", returned as `{ isError: true }`. To surface an actionable, client-facing message to the calling agent, throw `RpcException('...')` (from `@nestjs/microservices`) or register the library's `McpExceptionFilter` (exported from `@rekog/mcp-nest`) via `APP_FILTER` or `@UseFilters()`. Input/parameter validation errors are already returned as a clear `Invalid parameters: ...` tool result, so you don't need to handle those yourself.

### Creating an Exception Filter

```typescript
import { Catch, RpcExceptionFilter } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';

class CustomError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

@Catch(CustomError)
class CustomErrorFilter implements RpcExceptionFilter {
  catch(exception: CustomError): Observable<never> {
    // Throw (don't return) so the message is surfaced as an `isError` result.
    return throwError(() => ({
      status: 'error',
      message: `[${exception.code}] ${exception.message}`,
    }));
  }
}

@Catch()
class CatchAllFilter implements RpcExceptionFilter {
  catch(exception: Error): Observable<never> {
    return throwError(() => ({
      status: 'error',
      message: `Unexpected error: ${exception.message}`,
    }));
  }
}
```

> **Throw, don't return.** MCP handlers run in NestJS's RPC pipeline, so filters implement `RpcExceptionFilter` and signal failure by **throwing** (`throwError(...)`). A filter that instead *returns* a plain value tells NestJS that value **is the successful response** — for a tool it becomes a normal result with **no `isError`**, so the error silently masquerades as success. This mirrors the library's own `McpExceptionFilter`.

### Using Filters with Tools, Resources, and Prompts

Filters can be applied at the method level or class level:

```typescript
import { UseFilters } from '@nestjs/common';
import { McpController, Tool, Resource, Prompt } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
@UseFilters(CatchAllFilter)
class MyService {
  @Tool({
    name: 'my-tool',
    description: 'A tool with custom error handling',
    parameters: z.object({ input: z.string() }),
  })
  @UseFilters(CustomErrorFilter)
  async myTool(@Payload() { input }: { input: string }) {
    if (!input) {
      throw new CustomError('Input is required', 'VALIDATION_ERROR');
    }
    return `Processed: ${input}`;
  }

  @Resource({
    name: 'my-resource',
    description: 'A resource with error handling',
    uri: 'mcp://my-resource',
    mimeType: 'text/plain',
  })
  async myResource(@Payload() { uri }: { uri: string }) {
    throw new Error('Resource unavailable');
  }

  @Prompt({
    name: 'my-prompt',
    description: 'A prompt with error handling',
  })
  async myPrompt() {
    throw new CustomError('Prompt failed', 'PROMPT_ERROR');
  }
}
```

### How Errors Are Returned

Because the filters above **throw** the error (rather than returning a value), the surfaced message is handled based on the capability type:

- **Tools**: returned as `{ content: [{ type: 'text', text: filterMessage }], isError: true }`
- **Resources & Prompts**: thrown as MCP internal errors (code `-32603`) with the message in the error

> A tool-only filter may alternatively **return** a complete result object — `return { content: [{ type: 'text', text: '...' }], isError: true }` — which is respected verbatim. This does **not** work for resources/prompts (wrong result shape), so throwing is the portable choice.

### Filter Precedence

1. Method-level filters are checked first
2. Class-level filters are checked if no method-level filter matches
3. If no filter matches the exception type, default error handling is used

A catch-all filter (`@Catch()` with no arguments) will catch any exception that wasn't caught by more specific filters.

## Testing Your Tools

### 1. Start the Server

Run the example server:

```bash
cd examples/tools && npm install && npm start
```

### 2. List Available Tools

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3000/mcp --transport http --method tools/list
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
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3000/mcp --transport http --method tools/call --tool-name greet-user --tool-arg name=Alice --tool-arg language=es
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
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3000/mcp --transport http --method tools/call --tool-name greet-user-interactive --tool-arg name=Bob
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
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3000/mcp --transport http --method tools/call --tool-name greet-user-structured --tool-arg name=Charlie --tool-arg language=fr
```

Expected output:

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"greeting\": \"Hey, Charlie!\",\n  \"language\": \"fr\",\n  \"languageName\": \"English\"\n}"
    }
  ],
  "structuredContent": {
    "greeting": "Hey, Charlie!",
    "language": "fr",
    "languageName": "English"
  }
}
```

### 4. Interactive Testing

For interactive testing with progress updates, use the MCP Inspector UI:

```bash
npx @modelcontextprotocol/inspector@0.16.2
```

Connect to `http://localhost:3000/mcp` to test your tools interactively and see progress reporting in real-time.

## Tool Guards

Because tools are real RPC handlers, you protect them with standard NestJS `@UseGuards()` on the `@McpController` class or method — these run inside the RPC pipeline.

```typescript
import { Injectable, CanActivate, ExecutionContext, UseGuards } from '@nestjs/common';
import { McpController, Tool, McpContext } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    // In an RPC pipeline, read the MCP context and raw request via the context.
    const ctx = context.switchToRpc().getContext<McpContext>();
    const request = ctx.getRawRequest();
    return request?.user?.role === 'admin';
  }
}

@McpController()
export class MyTools {
  @Tool({
    name: 'admin-action',
    description: 'Only executable by admins',
    parameters: z.object({ target: z.string() }),
  })
  @UseGuards(AdminGuard)
  async adminAction(@Payload() { target }: { target: string }) {
    return { content: [{ type: 'text', text: `Admin action on ${target}` }] };
  }

  @Tool({
    name: 'secure-action',
    description: 'Requires both authentication and admin role',
    parameters: z.object({}),
  })
  @UseGuards(AuthGuard, AdminGuard)
  async secureAction() {
    return { content: [{ type: 'text', text: 'Secure action complete' }] };
  }
}
```

`@UseGuards()` can be combined with `@PublicTool()`, `@ToolScopes()`, and `@ToolRoles()` (the bespoke JWT-based authorization checks). Multiple guards use AND logic: all guards must pass for access to be granted.

Guards that rely on an HTTP request are not usable with STDIO transport (`ctx.getRawRequest()` is `undefined` there).

## Example Location

See the complete example at: `examples/tools/src/greeting.tool.ts`
