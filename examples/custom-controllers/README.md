# Two-layer pipeline: interceptors, filters & middleware

An MCP server in NestJS has **two layers** where you can attach standard
request-handling pieces, and they do different jobs. This example wires the same
three kinds of piece to **both** layers so you can watch the difference in the
logs.

Self-contained project verifying [`docs/custom-controllers.md`](../../docs/custom-controllers.md)
against the published `@rekog/mcp-nest@2.0.0-alpha.1`.

| piece | HTTP layer — `McpHttpController` | RPC layer — `@McpController` (`DemoTools`) |
| --- | --- | --- |
| **middleware** | ✓ logs every transport request | **N/A** — middleware is HTTP-only |
| **interceptor** | ✓ timing/logging per request | ✓ per **tool call**; can rewrite the result |
| **exception filter** | ✓ catches route-level throws | ✓ surfaces the real error of a thrown tool |

> The route is an ordinary NestJS controller
> (`McpHttpController extends McpHttpControllerFor(transport)`), so the entire
> Nest pipeline composes on it the normal way.

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

- **HTTP layer** sees *every transport request*: the `initialize` POST, the
  `tools/list` POST, the long-lived GET SSE stream, and **each** `tools/call`.
- **RPC layer** sees *only capability invocations* — one event per tool call,
  with the parsed tool name, validated arguments, and the `McpContext`, and it
  can rewrite the returned result.

One MCP session is many HTTP requests but only a handful of tool calls — so the
same `greet` call produces **one** `[rpc-interceptor]` line but several
`[http-*]` lines. That granularity difference is the whole point: attach a piece
at the layer that matches what you want to act on.

### Why no middleware on the RPC layer?

Middleware is part of the **HTTP** request pipeline (it's registered with
`consumer.apply(...).forRoutes(...)`), so it can only attach to an HTTP
controller. An `@McpController` has no HTTP routes — its methods are RPC message
handlers — so there is nothing for middleware to sit in front of. The RPC-layer
equivalents are **guards / interceptors / pipes**.

## The granularity ladder

Beyond the two layers, NestJS lets you scope a piece to exactly the breadth you
need. From widest to narrowest:

| Scope | Attach on | Runs for | Demoed by |
| --- | --- | --- | --- |
| **HTTP route** | `McpHttpController` | every transport request to `/mcp` | `HttpTimingInterceptor` |
| **RPC controller (class)** | `@McpController` class | every tool in the class | `RpcLoggingInterceptor` |
| **RPC tool (method)** | a single `@Tool` method | that one tool | `AuditInterceptor` (on `greet` only) |

They **stack** in order (global → controller → method), so a single `greet`
call runs both the class-level interceptor and its method-level one, while
`boom` runs only the class-level one:

```
greet:  [audit] greet invoked             ← method-level (greet only)
        [rpc-interceptor] DemoTools.greet ← class-level (all tools)
boom:   [rpc-interceptor] DemoTools.boom  ← class-level only — no [audit]
```

Note there is **no per-tool middleware** — middleware lives only at the HTTP
layer. To scope something to one tool, use a method-level interceptor or guard:
it runs in the RPC pipeline, so it has the parsed arguments and the `McpContext`
that middleware never sees.

## Files

| File | Layer | What it shows |
| --- | --- | --- |
| `src/mcp.runtime.ts` | — | The `StreamableHttpTransport` + `McpStrategy` (shared, no circular import). |
| `src/mcp-http.controller.ts` | HTTP | `McpHttpController` — the `/mcp` route, with HTTP `@UseInterceptors`/`@UseFilters`. |
| `src/http-layer.ts` | HTTP | `HttpLoggingMiddleware`, `HttpTimingInterceptor`, `HttpDemoExceptionFilter`. |
| `src/demo.tools.ts` | RPC | `@McpController() DemoTools`: class-level interceptor/filter, plus a method-level `AuditInterceptor` on `greet` only. |
| `src/rpc-layer.ts` | RPC | `RpcLoggingInterceptor` (class), `AuditInterceptor` (method), `RpcLoggingExceptionFilter` (extends the library's `McpExceptionFilter`). |
| `src/main.ts` | — | Module (incl. `configure()` for middleware) + bootstrap. |
| `scripts/call-tools.ts` | — | A tiny MCP client that calls `greet` then `boom`. |

## Run it

```bash
npm install

# Terminal 1 — start the server (default port 3000)
npm start

# Terminal 2 — drive it
npm run call
```

Every command honors a `PORT` env var (default `3000`), so run on another port
with `PORT=3111 npm start` (and the same `PORT` for `npm run call`).

The client prints:

```
Connected to http://localhost:3000/mcp
Tools: greet, boom
greet → {"type":"text","text":"Hello, Ada! [rpc]"}     ← RPC interceptor tagged the result
boom  → {"content":[{"type":"text","text":"intentional failure (RPC layer)"}],"isError":true}
```

`boom` throws `new Error('intentional failure (RPC layer)')`. The real message
reaches the client because `RpcLoggingExceptionFilter` extends the library's
`McpExceptionFilter`. **Without that filter**, NestJS masks it to a generic
`Internal server error`.

### What the server logs (the 5 active cells)

The HTTP-layer lines decode the JSON-RPC body, so you can see *which* MCP message
each `POST /mcp` was (not just an opaque path):

```
[http-middleware] POST /mcp → initialize                   reqId=xbnft5
[http-interceptor] POST /mcp → initialize                   reqId=xbnft5 took 10ms
[http-middleware] POST /mcp → notifications/initialized    reqId=878n18
[http-interceptor] POST /mcp → notifications/initialized    reqId=878n18 took 1ms
[http-middleware] GET  /mcp (SSE stream)                   reqId=xmcwgk
[http-middleware] POST /mcp → tools/list                   reqId=srih9c
[http-interceptor] POST /mcp → tools/list                   reqId=srih9c took 1ms
[http-middleware] POST /mcp → tools/call (greet)           reqId=f1hvdl
[http-interceptor] full JSON-RPC body for this request:
{
  "method": "tools/call",
  "params": {
    "name": "greet",
    "arguments": {
      "name": "Ada"
    }
  },
  "jsonrpc": "2.0",
  "id": 2
}
[audit] greet invoked                                          ← method-level: greet ONLY
[audit] greet → ok (0ms)
[rpc-interceptor] DemoTools.greet took 0ms                     ← class-level: every tool (+ tags result)
[http-interceptor] POST /mcp → tools/call (greet)           reqId=f1hvdl took 3ms
[http-middleware] POST /mcp → tools/call (boom)            reqId=1ufqg3
[rpc-interceptor] DemoTools.boom threw after 1ms               ← class-level fires for boom too — but no [audit]
[rpc-filter] caught: intentional failure (RPC layer) → surfacing real message   ← RPC filter (boom)
[http-interceptor] POST /mcp → tools/call (boom)            reqId=1ufqg3 took 1ms
[http-interceptor] GET  /mcp (SSE stream)                   reqId=xmcwgk took 19ms
```

Two things to notice:

- **One `greet` call = one `[rpc-interceptor]` line, but many `[http-*]` lines.**
  The session is `initialize` → `notifications/initialized` → a long-lived
  `GET` SSE stream → `tools/list` → each `tools/call`. The HTTP layer sees them
  all; the RPC layer sees only the two actual tool calls.
- **The one-time full-body dump** (on the first `tools/call`) shows exactly what a
  raw MCP message looks like at the HTTP boundary — `method`, `params.name`,
  `arguments`, and the JSON-RPC `id`. The decoder also handles **batch arrays**
  (logged as `[initialize, tools/list]`) and bodyless requests (labelled by verb,
  e.g. `(SSE stream)`).

> **On ordering:** the decoded method appears on the `[http-middleware]` line too,
> because in this Express app Nest's body parser runs *before* route middleware, so
> `req.body` is already parsed when the middleware logs. The decode reads only
> `req.body` (never the raw stream) — reading the raw stream here would starve the
> transport and break every call.

### Triggering the HTTP exception filter

The HTTP interceptor throws when a request carries `x-demo-fail: http`, and
`HttpDemoExceptionFilter` catches it:

```bash
curl -s -XPOST http://localhost:3000/mcp \
  -H 'content-type: application/json' -H 'x-demo-fail: http' \
  -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
# → {"jsonrpc":"2.0","error":{"code":-32099,"message":"Injected HTTP-layer failure (x-demo-fail: http)"},"id":null}
```

The server logs `[http-filter] caught: Injected HTTP-layer failure (x-demo-fail: http) → responding 418`.

> **Honest caveat:** a controller-scoped HTTP filter catches throws from the
> controller's own guards/interceptors/handler — **not** from middleware.
> Middleware runs before controller filters are in scope, so a throw there would
> go to a *global* filter (`APP_FILTER`). That's why the demo failure is injected
> from the interceptor, not the middleware.

## Takeaways

- Put **cross-cutting HTTP concerns** (request logging, raw-header auth,
  rate-limit headers, CORS-ish tweaks, timing) on the **`McpHttpController`** —
  they run once per transport request.
- Put **per-capability concerns** (tool-call auditing, result shaping,
  turning thrown errors into useful `isError` results, role/scope guards) on the
  **`@McpController`** — they run once per tool call and can touch the result.
- Scope something to **one tool** with a method-level `@UseInterceptors`/
  `@UseGuards` on that `@Tool` — it stacks on top of the class-level pieces
  (global → controller → method) and still has the args + `McpContext`.
- Reach for the library's **`McpExceptionFilter`** (globally via `APP_FILTER`, or
  per controller) when you want a tool's real error message to reach the agent.
