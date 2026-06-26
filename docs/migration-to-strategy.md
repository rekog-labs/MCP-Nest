# Migrating to the MCP Strategy API

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
| Raw HTTP request | third positional param | `ctx.getRawRequest()` |
| Runtime registration | `McpRegistryService.registerTool()` | `strategy.registerTool()` |

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
  transports: [new StreamableHttpTransport({ statelessMode: false })],
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
- If you use `@Ctx()`, you must also annotate the data param with `@Payload()`.
- `@Tool`, `@Resource`, `@ResourceTemplate`, and `@Prompt` are unchanged in shape;
  they now also emit the `@MessagePattern` metadata internally.

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
new StreamableHttpTransport({ endpoint: '/mcp', statelessMode: false, enableJsonResponse: false });
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

## 6. Authentication & authorization

Because MCP HTTP routes are mounted on the adapter (not as Nest controllers),
Nest controller/module guards no longer gate them at the HTTP layer. There is
also **no `guards` option on `McpStrategy`** (and no fake "AuthGate" idiom) — it
has been removed.

- **Authenticate** with Express middleware that sets `req.user` (and rejects with
  401 when appropriate). The built-in `ToolAuthorizationService` reads `req.user`
  to filter `tools/list` and gate `tools/call` against `@PublicTool`,
  `@ToolScopes`, and `@ToolRoles` (plus the `allowUnauthenticatedAccess`
  freemium flag).
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
- **Removed:** `McpModule` (`forRoot`/`forRootAsync`/`forFeature`), the
  `McpRegistryDiscoveryService` (capability metadata is now read directly off the
  decorated method), `McpRegistryService`, the
  `createStreamableHttpController`/`createSseController` factories, the
  `StdioService`, the **`SseTransport` (HTTP+SSE) transport**, the
  **`guards` option** on `McpStrategy`, the **`@ToolGuards()` decorator**, and
  the module options `transport`, `apiPrefix`, `sseEndpoint`, `messagesEndpoint`,
  `mcpEndpoint`, and `streamableHttp`.
