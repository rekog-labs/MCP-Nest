# How it connects: Transport, Server, and Controllers

This page explains the four objects that make up an MCP server in NestJS and how
they wire together. If you've used NestJS microservices before, most of this will
feel familiar — an MCP server is just a custom transport strategy, and your tools
are just message handlers.

There are four pieces. Three you write or construct; one the library gives you.

| Object | What it is | You write it as |
| --- | --- | --- |
| **Transport** | Owns the wire (HTTP verbs, sessions, SSE / stdio). | `new StreamableHttpTransport(...)` |
| **Server** (`McpStrategy`) | Owns the MCP protocol: discovers your tools, runs them through the Nest pipeline. | `new McpStrategy({ transports: [...] })` |
| **Capability controller** | Holds your `@Tool` / `@Resource` / `@Prompt` methods. | `@McpController()` class |
| **HTTP controller** | The actual `/mcp` route; applies guards, interceptors, filters. | `extends McpHttpControllerFor(transport)` |

The names overlap a little, so to be precise: there are **two** kinds of
controller, at two layers. The **capability controller** (`@McpController`)
carries your tools and handles MCP/RPC messages — it is *not* an HTTP route. The
**HTTP controller** is an ordinary `@Controller('mcp')` that *is* the route
clients connect to. They meet at the transport.

By convention this guide names the HTTP route class **`McpHttpController`** (and
`WeatherMcpController`, `TravelMcpController`, … with multiple servers), never
`McpController` — that bare name belongs to the `@McpController` decorator. Keep
the two visibly distinct in your own code and the layering stays obvious at a
glance.

---

## The one-minute version

```ts
// 1. A transport — owns the HTTP wire.
const transport = new StreamableHttpTransport();

// 2. A server — owns the protocol; runs ON that transport.
const strategy = new McpStrategy({
  name: 'my-server',
  version: '1.0.0',
  transports: [transport],
});

// 3. A capability controller — your tools live here.
@McpController()
export class GreetingTool {
  @Tool({ name: 'greet', description: 'Say hi', parameters: z.object({ name: z.string() }) })
  greet({ name }) {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  }
}

// 4. An HTTP controller — the /mcp route, where guards/interceptors apply.
@Controller('mcp')
@UseGuards(MyAuthGuard)
export class McpHttpController extends McpHttpControllerFor(transport) {}
```

```ts
// Wire it up in the module + bootstrap.
@Module({ controllers: [McpHttpController, GreetingTool] })
export class AppModule {}

const app = await NestFactory.create(AppModule);
strategy.setHttpAdapter(app.getHttpAdapter());
app.connectMicroservice({ strategy });
await app.startAllMicroservices();
await app.listen(3000);
```

That's a complete, authenticated MCP server. The rest of this page is *why* each
line is there.

---

## A request, end to end

```
POST /mcp                     ← MCP client
   │
   ▼
McpHttpController             (HTTP controller)
   │   @UseGuards, @UseInterceptors, @Version run here — normal Nest
   │   extends McpHttpControllerFor(transport)
   ▼
transport.handlePost(req,res) (StreamableHttpTransport)
   │   sessions, SSE streaming, raw-body — the wire protocol
   ▼
SDK McpServer                 (one per session, created by the strategy)
   │   JSON-RPC: "tools/call greet"
   ▼
McpStrategy request handler   (bound at startup)
   │   validates params, runs the Nest RPC pipeline
   ▼
GreetingTool.greet()          (your @Tool method on the capability controller)
```

The HTTP controller and the transport handle *transport*; the strategy and your
capability controller handle *protocol and logic*. The transport is the seam
between them.

---

## How each connection is made

There are really only three wires. Follow them one at a time.

### Wire 1 — Server ↔ Transport (a constructor argument)

The most direct one. A server runs on one or more transports, and you say so when
you construct it:

```ts
const transport = new StreamableHttpTransport();
const strategy  = new McpStrategy({ name, version, transports: [transport] });
```

At startup the strategy calls `transport.start(ctx)`, handing the transport a
context with everything it needs to serve requests (a factory for SDK servers,
the request-handler binder, the HTTP adapter, a logger). The transport owns the
wire; the strategy owns the protocol. This is the only wire that isn't NestJS
machinery — it's a plain object reference.

### Wire 2 — Capability controller ↔ Server (NestJS microservice routing)

This is standard NestJS, and it's worth seeing it as such. `@McpController`
composes `@Controller()`, and `@Tool` / `@Resource` / `@Prompt` compose
`@MessagePattern`. So a capability controller is a microservice controller, and
its methods are message handlers — the same way an `@EventPattern` handler binds
to a Kafka or NATS strategy.

NestJS binds each handler to the strategy whose **transport id** matches. For a
plain server that id is a shared default, so this "just works":

```ts
@McpController()                 // default transport id
class GreetingTool { /* @Tool ... */ }

new McpStrategy({ ... });        // same default id  →  handler binds here
```

You never see the id; it's the microservices framework doing what it always does.
The strategy then reads each bound handler's `@Tool` metadata at startup to build
its tool list. (Named servers override that id — see [Multiple servers](#multiple-servers-in-one-app).)

### Wire 3 — HTTP route ↔ Transport (the controller names it)

The route clients actually hit is an ordinary controller. `McpHttpControllerFor`
binds it to a transport by closure:

```ts
@Controller('mcp')
@UseGuards(MyAuthGuard)
export class McpHttpController extends McpHttpControllerFor(transport) {}
```

The base class it returns has the `@Post()` / `@Get()` / `@Delete()` handlers,
each delegating to `transport.handlePost/handleGet/handleDelete`. You own the
subclass, so the path, guards, interceptors, filters, and versioning are all
yours — applied the normal Nest way, because this really is a normal controller.

Naming the transport here also tells it "a controller owns the route," so the
transport **does not self-mount** its own bare route. You don't need a `mount:
false` flag; the binding implies it.

> **When you skip the HTTP controller.** If you don't write one, the transport
> self-mounts a route directly on the HTTP adapter at its `endpoint` (default
> `/mcp`). That's the zero-config path — but it runs *outside* the Nest pipeline,
> so no guards, interceptors, or global prefix apply. The moment you need any of
> those, write the HTTP controller. (You can't have both: claiming the route via
> a controller disables the self-mount.)

---

## The mental model

```
   @McpController (tools)  ──Wire 2 (Nest routing)──►  McpStrategy  ◄──Wire 1──►  Transport
                                                                                     ▲
   @Controller('mcp')      ──────────────Wire 3 (names the transport)───────────────┘
   (guards, the route)
```

- **The strategy is the server.** It's the hub. Tools bind *to* it (Wire 2); it
  runs *on* transports (Wire 1).
- **The transport is the wire**, and the meeting point: the strategy serves
  through it, and the HTTP controller delegates to it (Wire 3).
- **Two controllers, two jobs.** `@McpController` = *what the server can do*.
  `@Controller('mcp')` = *how clients reach it and who's allowed in*. Keeping them
  separate is what lets auth be one guard on one route, regardless of how many
  tools you have.

---

## Multiple servers in one app

Everything above composes. To run two independent MCP servers, give each a
**name**. The name is the one extra link, and it appears in exactly two places:

```ts
// Weather server
const weatherTransport = new StreamableHttpTransport();
const weatherStrategy  = new McpStrategy({ name: 'weather', version: '1', server: 'weather', transports: [weatherTransport] });

@McpController({ server: 'weather' })       // ← name, here …
class WeatherTool { /* @Tool get-weather */ }

@Controller('weather/mcp')
class WeatherMcpController extends McpHttpControllerFor(weatherTransport) {}
```

```ts
// Travel server — same shape, different name
const travelTransport = new StreamableHttpTransport();
const travelStrategy  = new McpStrategy({ name: 'travel', version: '1', server: 'travel', transports: [travelTransport] });

@McpController({ server: 'travel' })
class TravelTool { /* @Tool recommend-destination */ }

@Controller('travel/mcp')
class TravelMcpController extends McpHttpControllerFor(travelTransport) {}
```

The `server: 'weather'` string on the capability controller and on the strategy
is **Wire 2 with a name** — it scopes NestJS routing so the weather tools bind
only to the weather strategy. The HTTP controllers stay unambiguous because each
one *names its transport* (`McpHttpControllerFor(weatherTransport)`) — that's
Wire 3, and it's a concrete reference you can click through, not a string to
match.

So in the multi-server case you read each feature top to bottom and every link is
visible: the transport, the strategy that owns it, the tools scoped to its name,
and the route that delegates to it. Co-locate the four in one `weather/` file and
the whole chain is one screen.

---

## Summary

- An MCP **server** is a NestJS microservice **strategy** (`McpStrategy`). Connect
  it with `app.connectMicroservice({ strategy })`.
- It runs on one or more **transports** you pass in its constructor (Wire 1).
- Your **tools** live on `@McpController` classes — microservice controllers that
  NestJS routes to the strategy automatically (Wire 2).
- The **route** clients hit is an ordinary `@Controller` that
  `extends McpHttpControllerFor(transport)` — so guards and the rest of the Nest
  pipeline apply, and the controller names the transport it serves (Wire 3).
- For multiple servers, add a `server: '<name>'` to the strategy and its
  `@McpController`s; HTTP controllers stay clear because they reference their
  transport directly.
