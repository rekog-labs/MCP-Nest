## Documentation

- [Migration to the Strategy API](./migration-to-strategy.md) — Moving from `McpModule.forRoot(options)` to `McpStrategy` + `@McpController`.
- [Tools Guide](./tools.md) — How to create and register tools.
  - [Discovery and Registration of Tools](./tool-discovery-and-registration.md) — Automatic discovery via `@McpController` and runtime registration on the strategy.
  - [Dynamic Capabilities Guide](./dynamic-capabilities.md) — Register tools, resources, and prompts programmatically at runtime from databases or configuration.
  - [Per-Tool Authorization](./per-tool-authorization.md) — Concepts and mechanics of fine-grained authorization for individual tools.
    - [Per-Tool Authorization with JWT](./per-tool-authorization-jwt.md) — The simplest runnable setup: a hand-rolled JWT guard and pre-minted tokens.
    - [Per-Tool Authorization with OAuth](./per-tool-authorization-oauth.md) — Production setup with a real OAuth provider via `@rekog/mcp-nest-auth`.
- [Multiple MCP Servers](./multiple-servers.md) — Run several isolated MCP servers in one app with named servers (`@McpController({ server })` + `McpStrategy({ server })`).
- [Server Examples](./server-examples.md) — Example server setups and configurations.
  - [Custom Request Handling](./custom-controllers.md) — The two request-handling layers (HTTP route vs RPC `@McpController`): middleware, interceptors, exception filters, and `McpExceptionFilter`.
- [Prompts Guide](./prompts.md) — How to define and use prompts.
- [Resource Templates Guide](./resource-templates.md) — Resource URI templates and usage.
- [Resources Guide](./resources.md) — Defining and exposing resources.
- [Dependency Injection](docs/dependency-injection.md) — Leverage NestJS DI system throughout MCP components.
- [Server mutation and instrumentation](docs/server-mutation.md) — Mutate the underlying mcp server for custom logic or instrumentation purposes.

### Advanced Usage

- [Transports & endpoints](./migration-to-strategy.md#4-transports) — Configure `StreamableHttpTransport`/`StdioTransport` endpoints. The HTTP transport mounts its routes on the Nest HTTP adapter, so guards/interceptors/middleware apply via the standard NestJS RPC pipeline and `app.use(...)`.

### OAuth & Authorization

Both approaches let MCP clients authenticate. Which one you pick depends on
**who runs the MCP-spec authorization flow** (dynamic client registration,
consent, token issuance) — your own app, or an external server.

- [Built-in Authorization Server](./built-in-authorization-server.md) — Use when
  you want **your app to act as the authorization server**: implement the MCP
  authorization flow (dynamic client registration, consent, token issuance) and
  federate *user authentication* to an existing IdP (GitHub, Google, …). This is
  provided by `@rekog/mcp-nest-auth` (`McpAuthModule`). Make it your go-to when
  you don't have an MCP-Authz-compliant authorization server — or don't have one
  at all — and need your app to fill that role.
- [External Authorization Server](./external-authorization-server.md) —
  Use when a **separate authorization server owns the client registrations** and
  is **itself compliant with the MCP auth spec**. Then you don't need
  `@rekog/mcp-nest-auth` — you just add a controller that exposes the
  protected-resource metadata endpoint pointing clients at that server (as shown
  in the example), and validate the tokens it issues. The guide uses Casdoor as a
  concrete example, but it can be any spec-compliant server (Keycloak, Auth0,
  Okta, …).

## Examples

- [Examples README](../examples/README.md) — How to run and test the per-doc examples.
