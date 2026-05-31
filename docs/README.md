## Documentation

- [Migration to the Strategy API](./migration-to-strategy.md) — Moving from `McpModule.forRoot(options)` to `McpStrategy` + `@McpController`.
- [Tools Guide](./tools.md) — How to create and register tools.
  - [Discovery and Registration of Tools](./tool-discovery-and-registration.md) — Automatic discovery via `@McpController` and runtime registration on the strategy.
  - [Dynamic Capabilities Guide](./dynamic-capabilities.md) — Register tools, resources, and prompts programmatically at runtime from databases or configuration.
  - [Per-Tool Authorization](./per-tool-authorization.md) — How to implement fine-grained authorization for individual tools.
- [Server Examples](./server-examples.md) — Example server setups and configurations.
- [Prompts Guide](./prompts.md) — How to define and use prompts.
- [Resource Templates Guide](./resource-templates.md) — Resource URI templates and usage.
- [Resources Guide](./resources.md) — Defining and exposing resources.
- [Dependency Injection](docs/dependency-injection.md) — Leverage NestJS DI system throughout MCP components.
- [Server mutation and instrumentation](docs/server-mutation.md) — Mutate the underlying mcp server for custom logic or instrumentation purposes.

### Advanced Usage

- [Transports & endpoints](./migration-to-strategy.md#4-transports) — Configure `StreamableHttpTransport`/`SseTransport`/`StdioTransport` endpoints. HTTP transports mount their routes on the Nest HTTP adapter, so guards/interceptors/middleware apply via the standard NestJS RPC pipeline and `app.use(...)`.

### OAuth & Authorization

- [Built-in Authorization Server](./built-in-authorization-server.md) — Using the built-in Authorization Server for simpler setups.
- [External Authorization Server](./external-authorization-server/README.md) — Securing your MCP server with an external authorization server (Keycloak, Auth0, etc).

## Playground

- [Playground README](../playground/README.md) — How to use the playground examples and clients.
