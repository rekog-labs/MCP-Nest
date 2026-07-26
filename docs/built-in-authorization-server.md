# Built-in Authorization Server

The `McpAuthModule` provides a complete OAuth 2.1 compliant Identity Provider (IdP) implementation for securing MCP servers. It implements the [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) (against revision `2025-06-18`) and includes built-in support for popular OAuth providers like [GitHub](../packages/mcp-nest-auth/src/providers/github.provider.ts) and [Google](../packages/mcp-nest-auth/src/providers/google.provider.ts).

> **Protocol revisions.** Authorization is an HTTP-layer concern — a Bearer token
> on the transport request — so it is independent of which MCP protocol era
> serves that request. The same `McpAuthJwtGuard` gates 2025-era and
> `2026-07-28` clients alike (see [Protocol Revisions](protocol-revisions.md)).
> What *is* revision-specific is the advertised
> `mcp_versions_supported` in the protected-resource metadata. It defaults to
> `['2026-07-28', '2025-06-18']`, matching the default dual-era transport
> posture. If you pin the endpoint to one era with
> `protocol: 'legacy-only'` / `'modern-only'`, narrow it to match:
>
> ```typescript
> McpAuthModule.forRoot({
>   // ... required options
>   protectedResourceMetadata: {
>     mcpVersionsSupported: ['2025-06-18'],
>   },
> });
> ```

## Features

- **🔒 OAuth 2.1 Compliance**: Fully compliant with OAuth 2.1 and MCP Authorization specification
- **🏪 Multiple Storage Options**: In-memory (testing), TypeORM (production), or custom storage backends
- **🌐 Provider Support**: Built-in GitHub and Google OAuth providers with extensible provider system
- **🔑 Dynamic Client Registration**: RFC 7591 compliant client registration ([deprecated upstream](#dynamic-client-registration-deprecated-upstream-still-supported-here), still fully supported here)
- **📊 Authorization Server Discovery**: RFC 8414 and RFC 9728 compliant metadata endpoints
- **🛡️ Security**: mandatory [PKCE](#pkce-required-s256-only) with S256, Resource Indicators (RFC 8707), and comprehensive token validation
- **⚡ NestJS Integration**: Seamless integration with NestJS dependency injection and guards

## Quick Start

The fastest way to try out Remote MCP servers with built-in authentication is by deploying on Railway with the template below:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/G6BLGK?referralCode=XAdIhJ)

For the deployment you need the following:

1. Create a [New GitHub App](https://github.com/settings/applications/new), required for user authentication
    - For the "Authorization callback URL" add the placeholder `http://localhost:3000/auth/callback` and create the app, you will update it at step 4.
2. Add the GitHub Client ID and Client Secret in the Deploy panel on Railway, and click "Deploy"
3. After the app is deployed, the Custom Domain is available in the railway deployment settings page.
4. Update the "Authorization callback URL" of the GitHub app to the custom domain with the postfix as shown here: `https://<custom-domain>.up.railway.app/auth/callback`.

**And you are ready to roll!**

Open MCP Inspector at `https://<custom-domain>.up.railway.app/mcp` to see the available resources and tools.

The code of the deployed project is in this GitHub repository: [rekog-labs/mcp-nest-auth-starter](https://github.com/rekog-labs/mcp-nest-auth-starter).

## Setting up a new project

The `McpAuthModule` still provides the OAuth 2.1 controllers exactly as before.
MCP itself runs as a `McpStrategy` microservice. You mount the MCP transport
route as a real Nest controller (via `McpHttpControllerFor`) and protect it with
the built-in `McpAuthJwtGuard` — a NestJS guard that validates the Bearer JWT
(reusing the module's `JwtTokenService`), rejects missing/invalid tokens with
`401`, and sets `req.user`. Per-tool access is then enforced with standard
NestJS `@UseGuards()` on `@McpController` classes/methods and/or the
`@PublicTool()`/`@ToolScopes()`/`@ToolRoles()` decorators.

The built-in authorization server lives in a separate package. Install it alongside `@rekog/mcp-nest`:

```bash
npm install @rekog/mcp-nest-auth
```

```typescript
import { Controller, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
// Or if you are using CommonJS:
// import * as cookieParser from 'cookie-parser';
import {
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import {
  McpAuthModule,
  McpAuthJwtGuard,
  GitHubOAuthProvider,
} from '@rekog/mcp-nest-auth';
import { GreetingTool } from './greeting.tool';

// Shared transport instance so the guarded controller below binds to the SAME
// transport. Referencing it in McpHttpControllerFor auto-disables the
// transport's own self-mount, so there is no double route.
const mcpTransport = new StreamableHttpTransport();

const mcp = new McpStrategy({
  name: 'secure-mcp-server',
  version: '1.0.0',
  transports: [mcpTransport],
});

// Mount the MCP route as a real Nest controller and protect it with the
// built-in `McpAuthJwtGuard`. The guard validates the Bearer JWT (via the
// module's JwtTokenService), rejects missing/invalid tokens with 401, and sets
// `req.user`. The OAuth endpoints (/auth/*, /.well-known/*) stay open — only
// this controller is guarded — so the handshake can still run.
@Controller('mcp')
@UseGuards(McpAuthJwtGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      resource: 'http://localhost:3030/mcp',
      serverUrl: 'http://localhost:3030',
      apiPrefix: 'auth',
    }),
  ],
  controllers: [McpHttpController, GreetingTool], // + your @McpController() classes
  providers: [McpAuthJwtGuard],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Required for OAuth session management (this is NOT authentication).
  app.use(cookieParser());

  // Enable CORS for client applications
  app.enableCors({
    origin: true,
    credentials: true,
  });

  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });

  await app.startAllMicroservices(); // BEFORE listen()
  await app.listen(3030);
  console.log('Secure MCP Server running on http://localhost:3030');
}
void bootstrap();
```

Install dependencies:

```bash
npm install --save cookie-parser
npm install --save-dev @types/cookie-parser
```

## Reading the Authenticated User

The `McpAuthJwtGuard` above validates the token and sets `req.user`. Inside a
tool, inject it directly with `@McpUser()` — the auth-aware param decorator that
projects `req.user` (sugar over `@McpRawRequest()` + `.user`):

```typescript
import { McpController, Tool } from '@rekog/mcp-nest';
import { McpUser, McpUserPayload } from '@rekog/mcp-nest-auth';

@McpController()
export class GreetingTool {
  @Tool({ name: 'whoami', description: 'Return the authenticated user' })
  whoami(@McpUser() user?: McpUserPayload) {
    return {
      content: [
        { type: 'text', text: `Hello, ${user?.displayName ?? 'anonymous'}!` },
      ],
    };
  }
}
```

Pass a field name to project a single property, e.g. `@McpUser('email') email?: string`.

## Configuration Options

### Required Options

| Option | Type | Description |
|--------|------|-------------|
| `provider` | [`OAuthProviderConfig`](../packages/mcp-nest-auth/src/providers/oauth-provider.interface.ts) | OAuth provider configuration ([GitHubOAuthProvider](../packages/mcp-nest-auth/src/providers/github.provider.ts), [GoogleOAuthProvider](../packages/mcp-nest-auth/src/providers/google.provider.ts), or custom) |
| `clientId` | `string` | OAuth client ID from your provider |
| `clientSecret` | `string` | OAuth client secret from your provider |
| `jwtSecret` | `string` | JWT signing secret (minimum 32 characters) |

### Optional Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | `string` | `'https://localhost:3000'` | Base URL of your server |
| `jwtIssuer` | `string` | `serverUrl` | Canonical issuer identifier: the `iss` claim on every token, the `issuer` in the authorization-server metadata, and the RFC 9207 `iss` on authorization responses. Must name the same identifier as `serverUrl` (a trailing slash aside) or bootstrap throws — clients MUST NOT use metadata whose `issuer` differs from the URL they fetched it from. |
| `jwtAudience` | `string` | `'mcp-client'` | JWT audience claim |
| `jwtAccessTokenExpiresIn` | `string` | `'1d'` | Access token expiration |
| `jwtRefreshTokenExpiresIn` | `string` | `'30d'` | Refresh token expiration |
| `enableRefreshTokens` | `boolean` | `true` | Issue refresh tokens for offline access |
| `apiPrefix` | `string` | `''` | Prefix for all OAuth endpoints |
| `scopeValidation` | `'strict' \| 'passthrough'` | `'strict'` | See [Scope narrowing](#scope-narrowing) |
| `requirePkce` | `boolean` | `true` | Require `code_challenge` with `code_challenge_method=S256`. See [PKCE](#pkce-required-s256-only) |
| `cookieSecure` | `boolean` | `nodeEnv === 'production'` | Use secure cookies |
| `cookieMaxAge` | `number` | `24 * 60 * 60 * 1000` | Cookie expiration (24 hours) |
| `oauthSessionExpiresIn` | `number` | `10 * 60 * 1000` | OAuth session timeout (10 minutes) |
| `authCodeExpiresIn` | `number` | `10 * 60 * 1000` | Authorization code timeout (10 minutes) |
| `endpoints` | `object` | See below | Custom endpoint paths |
| `disableEndpoints` | `{ wellKnownAuthorizationServerMetadata?: boolean; wellKnownProtectedResourceMetadata?: boolean; register?: boolean }` | all `false` | Disable specific endpoints without changing their paths. See [Disabling Endpoints](#disabling-endpoints) |
| `storeConfiguration` | [`IOAuthStore`](../packages/mcp-nest-auth/src/stores/oauth-store.interface.ts) | In-memory | Storage backend configuration |
| `protectedResourceMetadata` | `{ scopesSupported?: string[]; bearerMethodsSupported?: string[]; mcpVersionsSupported?: string[] }` | `{ scopesSupported: [], bearerMethodsSupported: ['header'], mcpVersionsSupported: ['2026-07-28', '2025-06-18'] }` | Values advertised at the protected-resource metadata endpoint. Shallow-merged with the defaults, so you can override one key. Set `mcpVersionsSupported` to the MCP protocol revisions your endpoint actually serves. `scopesSupported` is omitted from the document when empty, and **should not** contain `offline_access` (see [Advertised scopes](#advertised-scopes)). |

### Token validation

`McpAuthJwtGuard` accepts a bearer token only if it is:

- signed with `jwtSecret` (HS256) and unexpired,
- issued by `jwtIssuer`,
- audienced at this server's `resource` (RFC 8707 §2), and
- of `type: 'access'`.

So a token minted for a *sibling* MCP resource on the same authorization server
is rejected, as is the browser-session cookie token replayed as a bearer
credential. If your `resource` option is not the URL clients actually connect to,
every request will 401 — the reason is logged at warn level by `JwtTokenService`.

### Scope narrowing

With the default `scopeValidation: 'strict'`, the `scope` a client requests at
`/authorize` is narrowed to what this server actually declares before it is
recorded on the session, the authorization code, and the token's `scope` claim.
The allowed set is the union of:

- `authorizationServerMetadata.scopesSupported` and
  `protectedResourceMetadata.scopesSupported`, and
- every scope declared with `@ToolScopes([...])` on a `@Tool` in your app.

Unknown scopes are dropped (not rejected), which is what an authorization server
is expected to do. Without this, any client could request the scopes your
`@ToolScopes()` tools check for and grant itself access.

Scopes attached to tools registered at runtime via `strategy.registerTool()` are
not discoverable this way — list those in
`authorizationServerMetadata.scopesSupported`.

`scopeValidation: 'passthrough'` restores the previous unchecked behaviour as a
migration window.

### Advertised scopes

There are two `scopesSupported` lists and they mean different things:

- `authorizationServerMetadata.scopesSupported` (default `['offline_access']`) —
  scopes this **authorization server** can grant. `offline_access` belongs here;
  it is what a client asks for to get a refresh token.
- `protectedResourceMetadata.scopesSupported` (default `[]`) — scopes this **MCP
  resource** understands. Revision `2026-07-28` adds a **SHOULD NOT** against
  listing `offline_access` here (or in a `WWW-Authenticate` challenge), because
  refresh tokens are never a resource requirement. List the scopes your
  `@ToolScopes()` tools require instead. When the list is empty the
  `scopes_supported` key is omitted from the metadata document rather than sent
  as `[]`, which would assert that the resource understands no scopes at all.

With `enableRefreshTokens: false`, `offline_access` is stripped from **both**
lists and `refresh_token` from `grant_types_supported`.

### PKCE (required, S256 only)

`/authorize` requires `code_challenge` with `code_challenge_method=S256`, and the
metadata advertises `code_challenge_methods_supported: ['S256']`. OAuth 2.1
§4.1.1 makes PKCE mandatory and permits `plain` only where S256 is unavailable,
which is never the case for an MCP client — advertising `plain` alongside S256
just invites a downgrade.

A request that omits `code_challenge`, sends `code_challenge_method=plain`, or
sends a challenge with no method (RFC 7636 §4.3 reads that as `plain`) is
returned to the client on its validated redirect URI as
`error=invalid_request`, with `state` and the RFC 9207 `iss` — it is a
post-validation failure, so RFC 6749 §4.1.2.1 says it belongs on the redirect URI
rather than in a `400` the client never sees. The token endpoint independently
refuses to redeem any authorization code that is not bound to an S256 challenge,
so a code minted by an older version or by a custom store cannot skip
verification either.

`requirePkce: false` is an escape hatch for a non-conforming client, and only
that:

```typescript
McpAuthModule.forRoot({
  // ... required options
  requirePkce: false, // logs a warning at bootstrap
});
```

It restores the pre-2.0.0 behaviour, where a missing challenge means no PKCE
verification at all and an intercepted authorization code is enough to obtain a
token. `plain` is still not advertised — add it explicitly via
`authorizationServerMetadata.codeChallengeMethodsSupported` if a migrating client
needs to discover it.

### Endpoint Configuration

```typescript
{
  endpoints: {
    // RFC 8414 (Authorization Server Metadata)
    wellKnownAuthorizationServerMetadata: '/.well-known/oauth-authorization-server',
    // RFC 9728 (Protected Resource Metadata / MCP discovery)
    wellKnownProtectedResourceMetadata: '/.well-known/oauth-protected-resource',
    // OAuth 2.1 flow endpoints
    register: '/register',
    authorize: '/authorize',
    callback: '/callback',
    token: '/token',
  }
}
```

### Disabling Endpoints

You can keep endpoint paths configured while preventing route registration via `disableEndpoints`:

```typescript
McpAuthModule.forRoot({
  // ... required options
  disableEndpoints: {
    wellKnownAuthorizationServerMetadata: true, // disables GET /.well-known/oauth-authorization-server
    wellKnownProtectedResourceMetadata: false,  // keeps GET /.well-known/oauth-protected-resource
    register: true,                             // disables POST /<apiPrefix>/register (DCR)
  },
});
```

`register: true` is for deployments that only ever talk to pre-registered
clients and do not want an open registration endpoint. The route is not
registered at all (so it answers `404`) and `registration_endpoint` is dropped
from the authorization-server metadata — advertising an endpoint that answers
`404` is worse than advertising none. DCR is **on** by default.

### Dynamic Client Registration (deprecated upstream, still supported here)

> **Deprecation notice.** MCP protocol revision **`2026-07-28`** deprecates
> Dynamic Client Registration (RFC 7591) in favour of **Client ID Metadata
> Documents** (CIMD) — spec [PR #2858](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2858).
> The draft's wording is *"Authorization servers and MCP clients **MAY** support
> the OAuth 2.0 Dynamic Client Registration Protocol (RFC7591). Note that Dynamic
> Client Registration is deprecated and retained for backwards compatibility with
> authorization servers that do not support Client ID Metadata Documents."*
>
> **Deprecated is not removed.** Under the spec's feature-lifecycle policy the
> minimum deprecation window is 12 months, so the earliest revision that could
> remove DCR is the first one released **on or after 2027-07-28**.
>
> `McpAuthModule` keeps DCR **fully supported**: `POST /<apiPrefix>/register`
> stays, `registration_endpoint` stays in the authorization-server metadata,
> no option is renamed, and registration does not emit a runtime warning. If you
> want it off, that is an explicit choice via
> `disableEndpoints: { register: true }`. CIMD support is tracked separately and
> is not a prerequisite for anything here.

Registration accepts the RFC 7591 fields plus the OIDC `application_type`:

```jsonc
{
  "client_name": "My MCP Client",
  "redirect_uris": ["http://127.0.0.1:33418/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "application_type": "native"  // 'native' | 'web', optional
}
```

`application_type` became a **client-side** MUST in `2026-07-28`, with the
explicit carve-out that *"non-OIDC servers safely ignore the parameter"*. This
authorization server is not an OIDC provider (no `id_token`, no `openid` scope,
no userinfo endpoint), so it:

- **stores** the value on the client record (available on `OAuthClient` and
  persisted by the TypeORM store),
- **rejects** anything other than `native` or `web` with a `400`, and
- **derives no behaviour** from it. In particular the OIDC redirect-URI
  constraints tied to `application_type` (localhost-only for `native`,
  https-only for `web`) are deliberately *not* enforced — they would reject
  legitimate MCP clients and are not required of a plain OAuth 2.1 server.

Omitting it is not an error; a conforming pre-2026 client must not be locked out.

> **TypeORM users:** `application_type` is a new nullable column on
> `rekog_mcp_auth_clients`. With `synchronize: true` it is added automatically;
> migration-managed deployments need an `ADD COLUMN application_type` (nullable
> string). Existing rows keep `NULL`, which reads back as absent.

## Storage Backends

### In-Memory Store (Default)

Perfect for development and testing:

```typescript
McpAuthModule.forRoot({
  // ... other options
  // No storeConfiguration needed - uses in-memory by default
})
```

### TypeORM Store

For production use with persistent storage:

```typescript
McpAuthModule.forRoot({
  // ... other options
  storeConfiguration: {
    type: 'typeorm',
    options: {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'user',
      password: 'password',
      database: 'oauth_db',
      synchronize: true, // Set to false in production
      logging: false,
    },
  },
})
```

> **Note**: The TypeORM store requires the optional peer dependencies `@nestjs/typeorm` and `typeorm` to be installed.

Supported TypeORM databases: PostgreSQL, MySQL, SQLite, SQL Server, Oracle, and more.

### Custom Store

Implement your own storage backend. See: [IOAuthStore interface](../packages/mcp-nest-auth/src/stores/oauth-store.interface.ts)

```typescript
import { IOAuthStore } from '@rekog/mcp-nest-auth';

class CustomStore implements IOAuthStore {
  // Implement required methods
}

McpAuthModule.forRoot({
  // ... other options
  storeConfiguration: {
    type: 'custom',
    store: new CustomStore(),
  },
})
```

## OAuth Providers

### GitHub Provider

See: [GitHubOAuthProvider](../packages/mcp-nest-auth/src/providers/github.provider.ts)

```typescript
import { GitHubOAuthProvider } from '@rekog/mcp-nest-auth';

// GitHub App setup required:
// 1. Create GitHub App at https://github.com/settings/apps
// 2. Set Authorization callback URL to: https://your-server.com/callback
// 3. Note the Client ID and generate Client Secret

McpAuthModule.forRoot({
  provider: GitHubOAuthProvider,
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  // ... other options
})
```

### Google Provider

See: [GoogleOAuthProvider](../packages/mcp-nest-auth/src/providers/google.provider.ts)

```typescript
import { GoogleOAuthProvider } from '@rekog/mcp-nest-auth';

// Google Cloud Console setup required:
// 1. Create OAuth 2.0 Client ID at https://console.cloud.google.com/apis/credentials
// 2. Add redirect URI: https://your-server.com/callback
// 3. Note the Client ID and Client Secret

McpAuthModule.forRoot({
  provider: GoogleOAuthProvider,
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  // ... other options
})
```

### Custom Provider

Create your own OAuth provider. See: [OAuthProviderConfig](../packages/mcp-nest-auth/src/providers/oauth-provider.interface.ts):

```typescript
import { OAuthProviderConfig } from '@rekog/mcp-nest-auth'; //

export const CustomOAuthProvider: OAuthProviderConfig = {
  name: 'custom',
  strategy: CustomStrategy, // Implement Passport strategy
  scopes: ['read:user'],
};
```

## API Endpoints

When `apiPrefix` is set to `'auth'`, the following endpoints are available:

### Authorization Server Metadata

- **GET** `/.well-known/oauth-authorization-server` - OAuth server metadata (RFC 8414) [can be disabled]

### Protected Resource Metadata

- **GET** `/.well-known/oauth-protected-resource` - Protected Resource metadata (RFC 9728, used by MCP for discovery) [can be disabled]

### OAuth Flow Endpoints

These are served under the configured `apiPrefix` (shown here with `apiPrefix: 'auth'`); the two `/.well-known/*` endpoints above remain at the root.

- **POST** `/auth/register` - Dynamic client registration (RFC 7591) [can be disabled] — *deprecated by MCP revision `2026-07-28` in favour of Client ID Metadata Documents ([PR #2858](https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2858)); earliest possible removal is the first revision released on or after 2027-07-28, and it remains fully supported here — see [Dynamic Client Registration](#dynamic-client-registration-deprecated-upstream-still-supported-here)*
- **GET** `/auth/authorize` - Authorization endpoint (requires PKCE `S256`)
- **GET** `/auth/callback` - OAuth callback endpoint
- **POST** `/auth/token` - Token endpoint

## Environment Variables

Create a `.env` file with the required variables:

```bash
# OAuth Provider (GitHub example)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-at-least-32-characters-long

# Server Configuration
SERVER_URL=https://your-server.com

# Database (if using TypeORM)
DATABASE_URL=postgresql://user:password@localhost:5432/oauth_db
```

## Troubleshooting

### Common Issues

1. **JWT Secret Too Short**: Ensure `jwtSecret` is at least 32 characters
2. **Invalid Redirect URI**: OAuth provider redirect URI must match `{serverUrl}/{apiPrefix}/callback`
3. **CORS Issues**: Enable CORS with `credentials: true` for browser-based clients
4. **Cookie Problems**: Ensure `cookieParser()` middleware is installed for session management
