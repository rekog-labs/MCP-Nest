# Custom Request Handling: the two-layer pipeline

An MCP server built with the strategy API is an ordinary NestJS application, so
the full request-handling pipeline — **middleware, guards, interceptors, pipes,
and exception filters** — is available. What is unique to MCP is that there are
**two layers** where those pieces attach, and they act on different things.

This guide explains the two layers conceptually. For a runnable server that wires
all three kinds of piece to both layers and prints exactly what each one sees,
see the [`custom-controllers`](../examples/custom-controllers/) example
project.

## The two layers

```
POST /mcp ──► [HTTP layer]  McpHttpController                 ← middleware, HTTP interceptor, HTTP filter
                  │            (one HTTP request)
                  ▼
              transport (sessions, SSE, raw body)
                  ▼
              [RPC layer]  @McpController  DemoTools.greet()   ← RPC interceptor, RPC filter
                           (one tool call)
```

- **HTTP layer** — the `/mcp` route. When a controller extends
  `McpHttpControllerFor(transport)` it owns that route, so anything you attach to
  it (`@UseInterceptors`, `@UseFilters`, module-level middleware) runs on **every
  transport request**: the `initialize` POST, the `tools/list` POST, the
  long-lived `GET` SSE stream, and **each** `tools/call`. This layer sees the raw
  HTTP request/response, before MCP is decoded.

- **RPC layer** — the `@McpController` capability class. Its `@Tool`/`@Resource`/
  `@Prompt` methods are NestJS microservice (`@MessagePattern`) handlers, so the
  RPC pipeline applies. Pieces here run **once per capability invocation** and see
  the parsed tool name, the validated arguments, and the `McpContext` — and they
  can rewrite the returned result.

A single MCP session is many HTTP requests but only a handful of tool calls, so
one `greet` call produces **one** RPC-interceptor line but several HTTP-layer
lines. Attach a piece at the layer that matches what you want to act on.

### Two controllers, two names

By convention the HTTP route controller is named `McpHttpController` (it
`extends McpHttpControllerFor(transport)`), while the capability class carries the
`@McpController()` decorator. They are distinct classes for distinct layers.

```typescript
// HTTP layer — owns the /mcp route
@Controller('mcp')
@UseInterceptors(HttpTimingInterceptor)
@UseFilters(HttpDemoExceptionFilter)
export class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

// RPC layer — the tools
@McpController()
@UseInterceptors(RpcLoggingInterceptor)
@UseFilters(RpcLoggingExceptionFilter)
export class DemoTools {
  @Tool({ name: 'greet', parameters: z.object({ name: z.string() }) })
  greet(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  }
}
```

In a guard or interceptor on the RPC layer, read the MCP context with
`context.switchToRpc().getContext<McpContext>()` and the raw HTTP request via
`.getRawRequest()`.

## Why middleware is HTTP-only

Middleware is part of the **HTTP** request pipeline — it is registered with
`consumer.apply(...).forRoutes(...)` on the module and sits in front of an HTTP
controller:

```typescript
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggingMiddleware).forRoutes(McpHttpController);
  }
}
```

An `@McpController` has no HTTP routes — its methods are RPC message handlers —
so there is nothing for middleware to sit in front of. The RPC-layer equivalents
are **guards, interceptors, and pipes**. Because they run in the RPC pipeline,
they have the parsed arguments and the `McpContext` that middleware never sees,
which is exactly why per-tool concerns (auditing, result shaping, scope checks)
belong there.

## The granularity ladder

Within these layers NestJS lets you scope a piece to exactly the breadth you
need. From widest to narrowest:

| Scope | Attach on | Runs for |
| --- | --- | --- |
| **HTTP route** | `McpHttpController` | every transport request to `/mcp` |
| **RPC controller (class)** | `@McpController` class | every tool in the class |
| **RPC tool (method)** | a single `@Tool` method | that one tool |

Pieces **stack** in order (global → controller → method). A method-level
`@UseInterceptors(AuditInterceptor)` on a single `@Tool` runs *in addition to* the
class-level interceptor, so that one tool fires both while its siblings fire only
the class-level one:

```
greet:  [audit] greet invoked             ← method-level (greet only)
        [rpc-interceptor] DemoTools.greet ← class-level (all tools)
boom:   [rpc-interceptor] DemoTools.boom  ← class-level only — no [audit]
```

There is **no per-tool middleware** — middleware lives only at the HTTP layer. To
scope something to one tool, use a method-level interceptor or guard.

## Surfacing a tool's real error with `McpExceptionFilter`

When a tool method throws, NestJS's default behavior masks the message to a
generic `Internal server error`. The library ships **`McpExceptionFilter`** (an
`RpcExceptionFilter`) that instead surfaces the real error message as an
`isError: true` tool result — the form an MCP client expects. Apply it globally
via `APP_FILTER`, or per controller, or extend it to add your own logging:

```typescript
@Catch()
export class RpcLoggingExceptionFilter extends McpExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    console.log(`[rpc-filter] caught: ${(exception as Error).message}`);
    return super.catch(exception, host); // keep the surfacing behavior
  }
}
```

With this filter a tool that throws `new Error('intentional failure')` reaches
the client as:

```json
{ "content": [{ "type": "text", "text": "intentional failure" }], "isError": true }
```

Without it, the same throw would arrive as an opaque `Internal server error`.

> **HTTP-layer filters and middleware:** a controller-scoped HTTP exception filter
> catches throws from the controller's own guards/interceptors/handler — **not**
> from middleware. Middleware runs before controller-scoped filters are in scope,
> so a throw there would go to a *global* filter (`APP_FILTER`).

## When to use which layer

- Put **cross-cutting HTTP concerns** (request logging, raw-header auth,
  rate-limit headers, timing) on the **`McpHttpController`** — they run once per
  transport request.
- Put **per-capability concerns** (tool-call auditing, result shaping, turning
  thrown errors into useful `isError` results, role/scope guards) on the
  **`@McpController`** — they run once per tool call and can touch the result.
- Scope to **one tool** with a method-level `@UseInterceptors`/`@UseGuards` on
  that `@Tool`.

## Runnable example

The [`custom-controllers`](../examples/custom-controllers/) example project
wires middleware, interceptors, and exception filters to **both** layers and
includes a client driver so you can watch each piece fire in the logs. See its
`README.md` for the full walkthrough and sample output.

## Related

- [Server Examples](server-examples.md) — transport/config variants, including the
  brief [Custom Request Handling](server-examples.md#custom-request-handling) snippet.
- [Tools](tools.md) — defining tools, guards, and filters at the tool level.
- [Per-Tool Authorization](per-tool-authorization.md) — guards/decorators for
  fine-grained access control on the RPC layer.
