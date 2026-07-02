# Migrating to MCP-Nest v2

MCP-Nest is now built on a **NestJS microservices custom transport strategy**
instead of an `McpModule.forRoot(options)` module that generated HTTP controllers.

The motivation: every tool/resource/prompt becomes a real `@MessagePattern`
handler, so the **full NestJS request pipeline applies to MCP calls** — guards,
pipes, interceptors, and exception filters all work out of the box, with proper
dependency injection and request scoping.

This guide maps the old API to the new one.

## Mental model

| Concept | Before | After |
| --- | --- | --- |
| Configuration | `McpModule.forRoot({ name, version, transport, ... })` | `new McpStrategy({ name, version, transports: [...] })` — no module |
| Where tools live | `@Injectable()` classes in `providers` | `@McpController()` classes in `controllers` |
| What a tool is | a discovered method | a `@MessagePattern` handler (discovery still drives metadata) |
| Transport selection | `transport: McpTransportType[]` | `transports: McpTransport[]` instances |
| Tool args | first positional param | `@Payload()` (or the first param by default) |
| Tool context | second positional param (`Context`) | `@Ctx() ctx: McpContext` |
| Raw HTTP request | third positional param | `ctx.getRawRequest()`, or inject directly with `@McpRawRequest()` |
| Runtime registration | `McpRegistryService.registerTool()` | `strategy.registerTool()` |
| Async config | `McpModule.forRootAsync({ useFactory, ... })` | build the strategy inside your own async `bootstrap()`, before `connectMicroservice` |
| Custom HTTP controller | inject `McpStreamableHttpService` + empty `transport: []` | `class X extends McpHttpControllerFor(transport)` |
| Resources / Prompts | same decorators, positional `(args, context, request)` | same decorators, now on `@McpController()` with `@Payload()`/`@Ctx()` — identical change to Tools |

## 1. Bootstrap

**Before:**

```typescript
@Module({
  imports: [McpModule.forRoot({ name: 'srv', version: '1.0.0' })],
  providers: [GreetingTool],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
await app.listen(3000);
```

**After:**

```typescript
export const mcp = new McpStrategy({
  name: 'srv',
  version: '1.0.0',
  transports: [new StreamableHttpTransport()],
});

@Module({
  controllers: [GreetingController],
  // Optional — only if a provider injects the strategy (e.g. dynamic registration).
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
class AppModule {}

const app = await NestFactory.create(AppModule);
mcp.setHttpAdapter(app.getHttpAdapter()); // needed for HTTP transports
app.connectMicroservice({ strategy: mcp });
await app.startAllMicroservices(); // BEFORE listen()
await app.listen(3000);
```

There is **no `McpModule`** — the strategy is the entire configuration. Capability
classes just need to be `@McpController()` and listed in a module's `controllers`
array; NestJS scans them when the strategy is connected.

### Async configuration (replaces `forRootAsync`)

There's no async factory API (no `useFactory`/`useClass`/`useExisting`) — build
the strategy inside your own async `bootstrap()` function, before
`connectMicroservice`:

```typescript
async function bootstrap() {
  const config = await loadConfig(); // e.g. from a ConfigService, remote source, etc.

  const mcp = new McpStrategy({
    name: config.mcpName,
    version: config.mcpVersion,
    transports: [new StreamableHttpTransport()],
  });

  @Module({
    controllers: [GreetingTool],
    providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(3000);
}
```

See `examples/server-examples/src/main-async.ts` for a full runnable version.

## 2. Capabilities become `@McpController`

NestJS only scans classes in a module's `controllers` array for microservice
handlers. So tool/resource/prompt classes must use `@McpController()` (which
composes `@Controller()`) and be registered as controllers.

```typescript
@McpController()
export class GreetingController {
  @Tool({ name: 'hello', description: '...', parameters: z.object({ name: z.string() }) })
  hello(@Payload() { name }: { name: string }, @Ctx() ctx: McpContext) {
    return { content: [{ type: 'text', text: `Hello ${name}` }] };
  }
}
```

- A method that only needs its arguments can keep `(args)` — the first parameter
  defaults to the payload.
- If you use `@Ctx()` (or any other param decorator such as `@McpRawRequest()`),
  you must also annotate the data param with `@Payload()`.
- `@Tool`, `@Resource`, `@ResourceTemplate`, and `@Prompt` are unchanged in shape;
  they now also emit the `@MessagePattern` metadata internally.

## 2b. Resources and Prompts migrate exactly like Tools

`@Resource`, `@ResourceTemplate`, and `@Prompt` go through the identical change
as `@Tool`: same decorator options, but the class becomes `@McpController()` and
the method signature moves from positional `(args, context, request)` to
`@Payload()` / `@Ctx()`.

```typescript
@McpController()
export class GreetingResource {
  @Resource({ name: 'languages', mimeType: 'application/json', uri: 'mcp://languages' })
  getLanguages(@Payload() { uri }: { uri: string }) {
    return { contents: [{ uri, mimeType: 'application/json', text: '...' }] };
  }

  @ResourceTemplate({ name: 'user-language', uriTemplate: 'mcp://users/{name}' })
  getUserLanguage(@Payload() { uri, name }: { uri: string; name: string }) {
    return { contents: [{ uri, mimeType: 'application/json', text: name }] };
  }
}

@McpController()
export class GreetingPrompt {
  @Prompt({ name: 'greet', parameters: z.object({ name: z.string() }) })
  greet(@Payload() { name }: { name: string }) {
    return {
      description: 'Greeting instructions',
      messages: [{ role: 'user', content: { type: 'text', text: `Greet ${name}` } }],
    };
  }
}
```

URI template matching is unchanged: named params (`{id}`), query params
(`{?a,b}`), and catch-all wildcards (`{path*}`, which matches one-or-more
segments and rejoins them into a single string, e.g. `path: 'docs/readme.md'`)
all still work.

See [Resources](resources.md), [Resource Templates](resource-templates.md), and
[Prompts](prompts.md) for full guides.

## 3. The execution context (`@Ctx()`)

`McpContext` implements the same surface as the old `Context` and adds accessors:

```typescript
ctx.reportProgress({ progress, total });   // session-aware transports only
ctx.log.info('message', data);             // server-side logging
ctx.mcpServer;                             // the MCP SDK server
ctx.mcpRequest;                            // the parsed JSON-RPC request
ctx.getSession();                          // { transport, stateless, sessionId }
ctx.getRawRequest();                       // the Express/Fastify request (undefined for stdio)
```

## 3b. Validation & NestJS enhancers

Because tools are real RPC handlers, standard NestJS enhancers apply. `@Tool`'s
Zod `parameters` still validate first (and define the advertised `inputSchema`),
and you can layer pipes/guards/interceptors/filters on top.

**A custom pipe** transforms the payload before the handler runs:

```typescript
@Injectable()
class UpperCaseNamePipe implements PipeTransform {
  transform(value: any) {
    if (value?.name) value.name = value.name.toUpperCase();
    return value;
  }
}

@McpController()
class Tools {
  @Tool({ name: 'shout', description: '...', parameters: z.object({ name: z.string() }) })
  shout(@Payload(UpperCaseNamePipe) { name }: { name: string }) {
    return { content: [{ type: 'text', text: name }] }; // already upper-cased
  }
}
```

**class-validator + `ValidationPipe`** for DTO-based validation. Keep a permissive
Zod schema for the advertised shape and let the DTO enforce business rules:

```typescript
import { IsInt, IsString, Min, MinLength } from 'class-validator';

class CreateUserDto {
  @IsString() @MinLength(3) name!: string;
  @IsInt() @Min(18) age!: number;
}

@McpController()
class UserTools {
  @Tool({
    name: 'create-user',
    description: 'Creates a user',
    parameters: z.object({ name: z.string(), age: z.number() }),
  })
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      // Surface a readable error to the MCP client (otherwise unknown errors
      // are masked to "Internal server error").
      exceptionFactory: (errors) =>
        new RpcException(
          'Validation failed: ' +
            errors.map((e) => Object.values(e.constraints ?? {}).join(', ')).join('; '),
        ),
    }),
  )
  createUser(@Payload() dto: CreateUserDto) {
    // `dto` is a validated CreateUserDto instance (transform: true).
    return { content: [{ type: 'text', text: `Created ${dto.name} (${dto.age})` }] };
  }
}
```

Install `class-validator` + `class-transformer` and ensure `emitDecoratorMetadata`
is enabled in `tsconfig.json`. A constraint violation returns
`{ isError: true }` with the `Validation failed: ...` message.

## 4. Transports

```typescript
new StreamableHttpTransport(); // stateless + JSON — the default
new StreamableHttpTransport({ statefulMode: true }); // session-managed + SSE
new StdioTransport();
```

> The legacy **HTTP+SSE** transport has been removed. Use Streamable HTTP (the
> current MCP HTTP transport) or stdio.

- The HTTP transport mounts its routes on the Nest HTTP adapter — there is no
  longer an `apiPrefix`/global-prefix mechanism for MCP; set the `endpoint`
  directly (a deeper path like `/api/service/mcp` works the same way).
- STDIO is session-aware now, so it supports progress and logging. Disable
  logging on stdio servers (`logging: false` + `{ logger: false }`) since stdout
  carries the protocol.

### Streamable HTTP is stateless by default (renamed `statelessMode` → `statefulMode`)

The old `statelessMode` flag is gone. The transport is now **stateless by
default**, and you opt into session management with `statefulMode: true`:

| Before | After |
| --- | --- |
| `new StreamableHttpTransport({ statelessMode: true })` | `new StreamableHttpTransport()` |
| `new StreamableHttpTransport({ statelessMode: false })` | `new StreamableHttpTransport({ statefulMode: true })` |

`enableJsonResponse` now **defaults to the session mode** instead of always
`false`: JSON in stateless mode (a plain POST gets a JSON reply), SSE in stateful
mode (so server-initiated messages can stream). Set it explicitly to override —
e.g. `new StreamableHttpTransport({ enableJsonResponse: false })` keeps SSE on a
stateless server.

- **Stateless** (default): every request is self-contained, a fresh server is
  created per request, and `GET`/`DELETE /mcp` return `405`. Best for most
  servers and REST-like usage.
- **Stateful**: sessions are tracked by the `mcp-session-id` header, with
  `GET /mcp` (SSE stream) and `DELETE /mcp` (teardown). Use it when you need
  server-initiated streaming/notifications tied to a long-lived session.

### Other transport & strategy options

- `sessionIdGenerator` — customize how stateful session IDs are generated:
  `new StreamableHttpTransport({ sessionIdGenerator: () => randomUUID() })`.
- `serverMutator` — wrap/extend the underlying MCP SDK server, e.g. for
  tracing/instrumentation (Sentry's `wrapMcpServerWithSentry`). See
  [Server Mutation](server-mutation.md).
- `logging` — `false` disables MCP-side logging entirely (do this for stdio
  servers); `{ level: [...] }` filters by level. Same shape as v1.
- The Fastify vs. Express adapter is auto-detected per request — no separate
  wiring needed. Use `NestFactory.create(AppModule, new FastifyAdapter())` and
  pass `app.getHttpAdapter()` to `mcp.setHttpAdapter()` as usual.

## 5. Dynamic registration

The old global `McpRegistryService` is removed. Register at runtime on the
strategy instead — inject it with the `MCP_STRATEGY` token (wire it yourself with
`{ provide: MCP_STRATEGY, useValue: strategy }` in your module's `providers`):

```typescript
@Injectable()
export class DynamicTools implements OnApplicationBootstrap {
  constructor(@Inject(MCP_STRATEGY) private readonly mcp: McpStrategy) {}
  onApplicationBootstrap() {
    this.mcp.registerTool({
      name: 'search',
      description: 'Search the KB',
      parameters: z.object({ query: z.string() }),
      handler: async (args, ctx, rawRequest) => ({
        content: [{ type: 'text', text: '...' }],
      }),
    });
  }
}
```

Dynamically registered handlers are invoked directly and **do not** pass through
the NestJS pipeline (no guards/pipes/interceptors).

The same applies to resources and prompts — `strategy.registerResource(def)` and
`strategy.registerPrompt(def)` — and all three have a matching
`removeTool`/`removeResource`/`removePrompt` for deregistration at runtime. See
[Dynamic Capabilities](dynamic-capabilities.md) for the full API reference,
database-backed examples, and multi-server isolation notes.

## 5b. Custom HTTP controllers (the `McpStreamableHttpService` replacement)

The old `McpStreamableHttpService` — inject the service, then hand-write
`@Post('/mcp')`/`@Get('/mcp')`/`@Delete('/mcp')` handlers that delegate to it —
is gone. Its replacement, `McpHttpControllerFor(transport)`, is a mixin that
turns a transport into a real NestJS controller **owning the route**, so it
composes the full Nest pipeline (`@UseGuards`, `@UseInterceptors`,
`@UseFilters`, `@Version`, module-level middleware) instead of you wiring each
verb by hand:

```typescript
const mcpTransport = new StreamableHttpTransport();

@Controller('mcp')
@UseGuards(MyAuthGuard)
@UseInterceptors(HttpTimingInterceptor)
export class McpHttpController extends McpHttpControllerFor(mcpTransport) {}
```

Merely referencing `transport.httpHandlers` — which `McpHttpControllerFor` does
at class-definition time — marks the route as claimed and auto-disables the
transport's own self-mounted routes, so there's no conflicting
double-registration to manage.

This is also where HTTP-layer authentication belongs (see next section) and
where request-level middleware (`consumer.apply(...).forRoutes(McpHttpController)`)
attaches — an `@McpController` capability class has no HTTP routes of its own,
so there's nothing for middleware to sit in front of there.

See [Custom Request Handling](custom-controllers.md) for the full two-layer
(HTTP + RPC) pipeline model and a runnable example.

## 6. Authentication & authorization

There is **no `guards` option on `McpStrategy`** (and no fake "AuthGate" idiom) —
it has been removed. Instead, mount the MCP transport route as a real Nest
controller (via `McpHttpControllerFor`, [above](#5b-custom-http-controllers-the-mcpstreamablehttpservice-replacement))
so standard Nest guards gate it at the HTTP layer on every transport request.

Authentication is **guards-only** — this isn't a step down from v1, which never
had a supported middleware alternative either: `McpModule.forRoot({ guards })`
applied guards directly to the generated controllers, and `McpAuthModule` itself
worked (and still works) by supplying a guard, e.g. `McpAuthJwtGuard`, into that
same slot. Plain `app.use(cookieParser())`-style middleware for unrelated HTTP
concerns still works as usual, but don't reach for middleware to set `req.user`
— use a guard.

- **Authenticate** with a NestJS guard on the MCP controller
  (`@UseGuards(YourGuard)`) that sets `req.user` (and throws
  `UnauthorizedException` when appropriate). The built-in
  `ToolAuthorizationService` reads `req.user` to filter `tools/list` and gate
  `tools/call` against `@PublicTool`, `@ToolScopes`, and `@ToolRoles` (plus the
  `allowUnauthenticatedAccess` freemium flag).
- **Enforce** per-tool access with standard `@UseGuards()` on the
  `@McpController` class or method — these run inside the RPC pipeline at call
  time. In a guard, use `context.switchToRpc().getContext<McpContext>()` and
  `.getRawRequest()`.
- `@ToolGuards()` has been **removed** (it had become a silent no-op) — use
  native `@UseGuards()` instead.

## 7. Behavioral changes to be aware of

- **Unknown errors are masked; actionable ones are not.** A tool that throws a
  plain `Error` (or even an `McpError`) inside the pipeline returns a graceful
  `{ isError: true }` with a generic "Internal server error" message, because
  NestJS's RPC exception handler masks unknown errors before the strategy sees
  them (this avoids leaking internals). Input/parameter problems are different:
  Zod validation returns a clear `Invalid parameters: …` result, so the agent
  knows to fix its input. To surface a custom, client-facing message for other
  failures, either:
  - `throw new RpcException('…')` (its payload is passed through unmasked), or
  - register the library's `McpExceptionFilter` (exported from `@rekog/mcp-nest`)
    via `{ provide: APP_FILTER, useClass: McpExceptionFilter }` or `@UseFilters`,
    which surfaces the original error message instead of masking it.
- **Request scoping:** `@Inject(REQUEST)` in a request-scoped tool resolves to the
  RPC request context, not the raw HTTP request. Read headers/user via
  `ctx.getRawRequest()`.
- **NestJS versioning is unaffected:** if your app uses `app.enableVersioning()`,
  the MCP endpoint stays unversioned (`VERSION_NEUTRAL`) — no extra config
  needed to keep `/mcp` reachable alongside versioned REST routes.
- **Removed:** `McpModule` (`forRoot`/`forRootAsync`/`forFeature`), the
  `McpRegistryDiscoveryService` (capability metadata is now read directly off the
  decorated method), `McpRegistryService`, the
  `createStreamableHttpController`/`createSseController` factories, the
  `StdioService`, the **`SseTransport` (HTTP+SSE) transport**, the
  **`guards` option** on `McpStrategy`, the **`@ToolGuards()` decorator**, and
  the module options `transport`, `apiPrefix`, `sseEndpoint`, `messagesEndpoint`,
  `mcpEndpoint`, and `streamableHttp`.

## 8. Multiple servers in one app (the `forFeature` replacement)

`McpModule.forFeature([...], 'server-name')` registered capability classes to a
*named* server so a monolith could expose several MCP servers, each with its own
tool set. The strategy API does the same with **named servers**: tag a controller
with `@McpController({ server: 'name' })` and it binds only to a
`McpStrategy({ server: 'name' })` connected on its own endpoint. Unnamed
controllers/strategies keep the single shared-server behavior.

Sharing a tool across servers is ordinary NestJS DI — put the logic in an
`@Injectable()` service and re-declare a thin `@Tool` on each server's controller
(a class is tagged for exactly one server, but the service can back many).

See **[Multiple MCP Servers](./multiple-servers.md)** for the full pattern and a
runnable example.

## 9. Where to go next

This guide covers the migration; each topic has a deeper standalone guide:

- [How It Connects](how-it-connects.md) — the pieces (transport, strategy,
  `@McpController`, `McpHttpControllerFor`) and how they wire together.
- [Tools](tools.md), [Resources](resources.md),
  [Resource Templates](resource-templates.md), [Prompts](prompts.md) — full
  capability guides.
- [Tool Discovery & Registration](tool-discovery-and-registration.md) — how
  decorator discovery and dynamic registration are picked up.
- [Dynamic Capabilities](dynamic-capabilities.md) — the full
  `registerTool`/`registerResource`/`registerPrompt` API, database-backed
  examples, and multi-server isolation for dynamic caps.
- [Custom Request Handling](custom-controllers.md) — the two-layer
  (HTTP + RPC) pipeline in depth.
- [Server Mutation](server-mutation.md) — wrapping the underlying MCP SDK
  server (`serverMutator`), e.g. for Sentry tracing.
- [Per-Tool Authorization](per-tool-authorization.md) (+
  [JWT](per-tool-authorization-jwt.md), [OAuth](per-tool-authorization-oauth.md)
  walkthroughs) — `@PublicTool`/`@ToolScopes`/`@ToolRoles` in depth.
- [Multiple MCP Servers](multiple-servers.md) — named servers, replacing
  `forFeature`.
