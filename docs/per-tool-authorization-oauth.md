# Per-Tool Authorization with OAuth

The production setup for [per-tool authorization](per-tool-authorization.md): a
real OAuth provider (GitHub, here) fronted by the `@rekog/mcp-nest-auth`
authorization server. Read the [concepts guide](per-tool-authorization.md) first
for how the two authorization layers fit together.

If you just want to see per-tool authorization work without registering an OAuth
app, start with the simpler [JWT guide](per-tool-authorization-jwt.md) — it uses
the same decorators and authorization service, only with a hand-rolled guard and
pre-minted tokens instead of a full OAuth handshake.

## What changes vs. the JWT guide

Only the identity layer. Instead of a hand-rolled guard verifying a static JWT,
you use:

- **`McpAuthModule`** — the OAuth 2.1 authorization server. It provides the
  `/register`, `/authorize`, `/token`, and `.well-known/*` controllers, and
  delegates the login to GitHub. It mints the JWT the MCP client presents.
- **`McpAuthJwtGuard`** — the library's own guard. It validates that minted JWT
  and enriches `req.user` with `username`/`displayName`/`name`/`scopes`/`roles`,
  which the per-tool decorators and tool handlers read.

The tool definitions (`@PublicTool()`, `@ToolScopes()`, `@ToolRoles()`) are
unchanged — see [Define Tools](per-tool-authorization.md#define-tools).

## Install

The OAuth authorization server ships as a separate package. Install it alongside
`@rekog/mcp-nest`:

```bash
npm install @rekog/mcp-nest-auth
```

## The wiring

Bind `McpAuthJwtGuard` to the MCP controller and import `McpAuthModule`. See
[`examples/per-tool-authorization-oauth/src/main.ts`](../examples/per-tool-authorization-oauth/src/main.ts)
for the complete, runnable version (including storage-backend options); run it
with `cd examples/per-tool-authorization-oauth && npm install && npm start`:

```typescript
import { Controller, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import {
  GitHubOAuthProvider,
  McpAuthJwtGuard,
  McpAuthModule,
} from '@rekog/mcp-nest-auth';
import { MyTools } from './my-tools';

const JWT_SECRET = process.env.JWT_SECRET!;
const allowUnauthenticatedAccess =
  process.env.ALLOW_UNAUTHENTICATED_ACCESS === 'true';

// Shared const so the guarded HTTP controller can bind to the SAME transport
// instance via `McpHttpControllerFor(mcpTransport)`.
const mcpTransport = new StreamableHttpTransport();

const strategy = new McpStrategy({
  name: 'my-mcp-server',
  version: '1.0.0',
  transports: [mcpTransport],
  allowUnauthenticatedAccess,
});

// `McpHttpControllerFor(mcpTransport)` makes this a real NestJS controller that
// owns the `/mcp` route (and auto-disables the transport's self-mount), so
// `McpAuthJwtGuard` runs once per request — including `tools/list`.
@Controller('mcp')
@UseGuards(McpAuthJwtGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

@Module({
  imports: [
    // McpAuthModule is NOT McpModule. It provides the OAuth 2.1
    // register/authorize/token/well-known controllers (acting as the
    // Authorization Server that delegates to GitHub) and mints the JWT.
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      jwtSecret: JWT_SECRET,
      serverUrl: process.env.SERVER_URL,
      resource: process.env.SERVER_URL + '/mcp',
      apiPrefix: 'auth',
      // storeConfiguration defaults to an in-memory store; use TypeORM or a
      // custom store for persistence. See docs/built-in-authorization-server.md
      // for the store options.
    }),
  ],
  controllers: [McpHttpController, MyTools],
  providers: [
    McpAuthJwtGuard,
    // The guard reads `allowUnauthenticatedAccess` from the optional MCP_OPTIONS
    // token. Provide it explicitly so the flag works through the guard.
    { provide: 'MCP_OPTIONS', useValue: { allowUnauthenticatedAccess } },
  ],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(3013);
}
void bootstrap();
```

When the guard rejects requests without a valid token, all traffic requires
authentication by default. This security-first approach ensures that:

* **Unauthenticated requests are rejected** — preventing anonymous access to your server
* **MCP Authorization Flow is triggered** — prompting clients to authenticate when needed
* **Protected tools remain secure** — only authenticated users can access any functionality

## ChatGPT Integration Behavior

In ChatGPT, users have two authentication options:

1. **Full Authentication** — Users authenticate to access all tools (public and protected)
2. **No Authentication** — Users skip authentication and can only access `@PublicTool()` tools

## Configuring public access (freemium)

By default, `allowUnauthenticatedAccess` is `false`: the guard rejects tokenless
requests and the strategy requires a user for every non-public tool. Because both
the guard's tokenless branch and the strategy read the one
`allowUnauthenticatedAccess` flag, enabling public access is a single toggle — no
per-tool code change:

```bash
ALLOW_UNAUTHENTICATED_ACCESS=true
```

When `true`, unauthenticated users can access `@PublicTool()` tools while
protected tools still require authentication.

`McpAuthJwtGuard` already contains the tokenless branch, but reads the flag from
an injected `'MCP_OPTIONS'` provider (defaulting to strict). Provide it alongside
the strategy flag — as shown in the wiring above — to turn on freemium:

```typescript
providers: [
  { provide: 'MCP_OPTIONS', useValue: { allowUnauthenticatedAccess: true } },
],
```

---

For scopes/roles enforcement mechanics, see the
[concepts guide](per-tool-authorization.md). The
[per-tool-auth E2E test](../tests/mcp-per-tool-auth.e2e.spec.ts) is a full working
example with public, protected, scoped, and role-based tools.
