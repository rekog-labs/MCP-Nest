# Examples

Each subdirectory is a **self-contained greenfield project** that verifies one
documentation page against the published alpha packages
(`@rekog/mcp-nest@2.0.0-alpha.1`, and `@rekog/mcp-nest-auth@2.0.0-alpha.1` for the
auth examples). They are independent npm projects — install and run each on its own.

## Run any example

```bash
cd examples/<project>
npm install
npm start            # serves the MCP endpoint at http://localhost:3000/mcp
```

Every project reads a `PORT` env var (default `3000`), so run several at once with
`PORT=3105 npm start`. See each project's own `README.md` for the exact
run/test commands.

## Test with the MCP Inspector CLI

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3000/mcp \
  --transport http --method tools/list | jq '.tools[].name'
```

## Projects

| Project | Verifies | Notes |
| --- | --- | --- |
| [`tools`](./tools/) | [tools.md](../docs/tools.md) | tools, progress, output schema, elicitation, guards, filters |
| [`resources`](./resources/) | [resources.md](../docs/resources.md) | static resources |
| [`resource-templates`](./resource-templates/) | [resource-templates.md](../docs/resource-templates.md) | parameterized URI templates |
| [`prompts`](./prompts/) | [prompts.md](../docs/prompts.md) | prompt templates, roles, content types |
| [`dependency-injection`](./dependency-injection/) | [dependency-injection.md](../docs/dependency-injection.md) | DI + request scoping |
| [`dynamic-capabilities`](./dynamic-capabilities/) | [dynamic-capabilities.md](../docs/dynamic-capabilities.md) | runtime register/deregister |
| [`server-mutation`](./server-mutation/) | [server-mutation.md](../docs/server-mutation.md) | instrumentation/tracing via `serverMutator` hooks |
| [`tool-discovery`](./tool-discovery/) | [tool-discovery-and-registration.md](../docs/tool-discovery-and-registration.md) | decorator discovery + feature modules |
| [`multiple-servers`](./multiple-servers/) | [multiple-servers.md](../docs/multiple-servers.md) | two named servers on `/weather/mcp` + `/travel/mcp` |
| [`server-examples`](./server-examples/) | [server-examples.md](../docs/server-examples.md) | one `src/main-*.ts` per transport/config variant |
| [`custom-controllers`](./custom-controllers/) | [custom-controllers.md](../docs/custom-controllers.md) | HTTP vs RPC pipeline: middleware, interceptors, exception filters + `McpExceptionFilter` |
| [`per-tool-authorization`](./per-tool-authorization/) | [per-tool-authorization.md](../docs/per-tool-authorization.md) | `@PublicTool`/`@ToolScopes`/`@ToolRoles` |
| [`per-tool-authorization-jwt`](./per-tool-authorization-jwt/) | [per-tool-authorization-jwt.md](../docs/per-tool-authorization-jwt.md) | local JWT auth (mint via `scripts/mint-jwts.ts`) |
| [`per-tool-authorization-oauth`](./per-tool-authorization-oauth/) | [per-tool-authorization-oauth.md](../docs/per-tool-authorization-oauth.md) | OAuth per-tool auth |
| [`built-in-authorization-server`](./built-in-authorization-server/) | [built-in-authorization-server.md](../docs/built-in-authorization-server.md) | `McpAuthModule` OAuth server |
| [`external-authorization-server-casdoor`](./external-authorization-server-casdoor/) | [external-authorization-server.md](../docs/external-authorization-server.md) | runnable Casdoor AS (Docker): login + consent + DCR, MCP as resource server validating external tokens |
| [`azure-ad-oauth-provider`](./azure-ad-oauth-provider/) | [azure-ad-oauth-provider.md](../docs/azure-ad-oauth-provider.md) | Azure AD OAuth provider |
| [`azure-ad-provider`](./azure-ad-provider/) | [azure-ad-provider.md](../docs/azure-ad-provider.md) | Azure AD provider |

### Offline auth testing

The auth projects (`per-tool-authorization-oauth`, `built-in-authorization-server`,
`azure-ad-*`) support a fake/offline mode via
`MCP_FAKE_AUTH=1` — no external Identity Provider needed. When real provider
credentials are set in the environment, they use the real provider instead. See
each project's `README.md` for details.
