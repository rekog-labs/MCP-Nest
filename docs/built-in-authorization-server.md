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
- **🪪 Client ID Metadata Documents**: opt-in, SSRF-guarded [CIMD](#client-id-metadata-documents-cimd) support — the mechanism `2026-07-28` prefers over DCR
- **✋ Consent screen**: opt-in [interactive consent](#consent-screen), with the redirect-URI hostname displayed as the spec requires
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
| `consent` | `{ enabled?: boolean; render?: (ctx) => string \| Promise<string>; rememberForMs?: number }` | `{ enabled: false, rememberForMs: 30 days }` | Interactive consent screen. `enabled` defaults to **`true`** whenever `clientIdMetadataDocuments.enabled` is set. See [Consent screen](#consent-screen) |
| `clientIdMetadataDocuments` | `{ enabled?: boolean; allowInsecureClientIdScheme?: boolean; cacheTtlMs?: number; maxCacheEntries?: number; timeoutMs?: number; maxDocumentBytes?: number }` | `{ enabled: false, allowInsecureClientIdScheme: false, cacheTtlMs: 300000, maxCacheEntries: 256, timeoutMs: 5000, maxDocumentBytes: 5120 }` | Accept URL-shaped `client_id`s by fetching the client's own metadata document. See [CIMD](#client-id-metadata-documents-cimd) |
| `cookieSecure` | `boolean` | `nodeEnv === 'production'` | Use secure cookies |
| `cookieMaxAge` | `number` | `24 * 60 * 60 * 1000` | Cookie expiration (24 hours) |
| `skipCookieParserCheck` | `boolean` | `false` | Allow the app to start without `cookie-parser` mounted. Only for hosts that populate `req.cookies` another way — the check finds the middleware by name and cannot see a wrapped or re-exported one. |
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
    // Only registered when the consent screen is enabled.
    consent: '/consent',
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
> `disableEndpoints: { register: true }`.
>
> **CIMD is implemented** — see [Client ID Metadata Documents](#client-id-metadata-documents-cimd).
> It is opt-in (`clientIdMetadataDocuments: { enabled: true }`) and independent of
> DCR: both mechanisms can be on at once, they share one `client_id` keyspace
> safely, and clients pick whichever the metadata advertises.

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

### Consent screen

Off by default. Turned on, the OAuth callback stops redirecting and instead
answers with a page asking the signed-in user to approve the grant:

```typescript
McpAuthModule.forRoot({
  // ... required options
  consent: { enabled: true },
});
```

```
/authorize ──▶ IdP login ──▶ /callback ──▶ [consent screen]
                                               │
                              Approve ─────────┴───────── Deny
                                 │                          │
                     POST /consent                POST /consent
                                 │                          │
                     code on redirect_uri     error=access_denied
```

**Why it sits between the IdP callback and the authorization code.** Two
constraints pin it there: recording an approval needs an authenticated principal,
which only exists after the IdP round-trip; and the spec wants the redirect-URI
hostname shown *during authorization*, which stops being true once the code has
been minted and the browser is on its way back to the client.

The built-in page is one self-contained HTML document (inline styles, no scripts,
no external assets, light and dark) and shows:

- the client name and the signed-in user,
- **the redirect URI hostname**, as its own prominent field. This is a
  MUST for a CIMD-capable authorization server: *"authorization servers ...
  **MUST** clearly display the redirect URI hostname during authorization"*
  ([security considerations](https://modelcontextprotocol.io/specification/draft/basic/authorization/security-considerations#client-id-metadata-document-security)),
- an extra **warning when that hostname is loopback** (a SHOULD from the same
  section): a Client ID Metadata Document cannot prevent `localhost`
  impersonation, because any local process can bind a port and claim to be the
  client whose document the server just fetched,
- the scopes that will actually be granted — already
  [narrowed](#scope-narrowing), so the user approves what they will get rather
  than what was asked for,
- **Approve** / **Deny** buttons in a form that POSTs to `/<apiPrefix>/consent`.

`POST /<apiPrefix>/consent` requires the `oauth_session` cookie *and* a hidden
`consent_token` matching the session's server-side `state`. The token only ever
travels inside an `httpOnly` cookie and in the page's own markup, so a form on
another origin — which would still carry the user's ambient cookies — cannot
approve on their behalf. The route is not registered at all when consent is off,
and a decided session is consumed, so an approval cannot be replayed for a second
code.

#### Remembering approvals

An approval is remembered for the same **(user, client, scope)** triple for
`rememberForMs` (default 30 days), so reconnecting does not re-prompt. Scope sets
are order-normalised, and a client that later asks for *more* scope is prompted
again. `rememberForMs: 0` prompts every time.

> ⚠️ Remembered **in process memory**, not in the `IOAuthStore`. A restart or a
> second replica re-prompts. That is deliberate: an approval is a "don't ask me
> again" convenience, not authorization state — nothing is granted on the strength
> of one without a live authenticated session as well — and adding required methods
> to `IOAuthStore` (public API with a documented custom-store contract) would break
> every custom store for a UX optimisation.

#### Custom page

`render` replaces the built-in page entirely. Return a complete HTML document; it
is sent as `text/html` with `Cache-Control: no-store`.

```typescript
McpAuthModule.forRoot({
  // ... required options
  consent: {
    enabled: true,
    render: (ctx) => `
      <!doctype html><html><body>
        <h1>Allow ${escapeHtml(ctx.client.client_name)}?</h1>
        <p>The authorization code will be sent to <b>${escapeHtml(ctx.redirectUriHost)}</b></p>
        ${ctx.isLoopbackRedirect ? '<p>⚠️ That is an address on your own computer.</p>' : ''}
        <form method="post" action="${ctx.formAction}">
          <input type="hidden" name="consent_token" value="${ctx.csrfToken}">
          <button name="approve" value="true">Approve</button>
          <button name="approve" value="false">Deny</button>
        </form>
      </body></html>`,
  },
});
```

The context (`ConsentRenderContext`) carries `client`, `clientId`,
`isMetadataDocumentClient`, `redirectUri`, `redirectUriHost`,
`isLoopbackRedirect`, `isLoopbackOnlyClient`, `scopes`, `user`, `formAction` and
`csrfToken`.

Two things are on you in a custom renderer:

1. **Escape everything.** With CIMD enabled, `client_name`, `client_uri` and
   `logo_uri` come from a document hosted by whoever chose the `client_id`, and
   your page renders on the authorization server's own origin — where the browser
   session cookie lives. The built-in renderer escapes; a template that does not
   is stored XSS.
2. **Keep the hidden `consent_token` field**, or nothing can ever be approved,
   and keep displaying `redirectUriHost` (and the loopback warning) or the
   deployment drops out of conformance.

### Client ID Metadata Documents (CIMD)

MCP revision `2026-07-28` deprecates Dynamic Client Registration in favour of
**Client ID Metadata Documents**
([draft-ietf-oauth-client-id-metadata-document-00](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-client-id-metadata-document-00),
[MCP client registration](https://modelcontextprotocol.io/specification/draft/basic/authorization/client-registration#client-id-metadata-documents)).
A client identifies itself with an `https` URL that serves its own metadata; the
authorization server fetches it on demand. There is **no registration step and no
stored client record**.

```typescript
McpAuthModule.forRoot({
  // ... required options
  clientIdMetadataDocuments: { enabled: true },
  // consent.enabled becomes true automatically — see below
});
```

Enabling it adds `client_id_metadata_document_supported: true` to the
authorization-server metadata (the key is omitted, not sent as `false`, when
disabled — clients are told to prefer CIMD whenever they see the flag, so
advertising it on a server that rejects every URL `client_id` would push them into
a dead end instead of the `registration_endpoint` right next to it).

A client then just uses its document URL as `client_id`:

```
GET /auth/authorize
  ?response_type=code
  &client_id=https%3A%2F%2Fapp.example.com%2Fclient-metadata.json
  &redirect_uri=http%3A%2F%2F127.0.0.1%3A33418%2Fcallback
  &code_challenge=…&code_challenge_method=S256
```

```jsonc
// https://app.example.com/client-metadata.json
{
  "client_id": "https://app.example.com/client-metadata.json",  // MUST match the URL exactly
  "client_name": "Example MCP Client",
  "client_uri": "https://app.example.com",
  "logo_uri": "https://app.example.com/logo.png",
  "redirect_uris": ["http://127.0.0.1:33418/callback"],
  "grant_types": ["authorization_code"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"
}
```

`client_id`, `client_name` and `redirect_uris` are required. DCR and CIMD coexist:
registered ids are always `${normalizedName}_${suffix}` with the name reduced to
`[a-z0-9]`, so they can never contain `://` and the two keyspaces cannot collide.
`ClientService.getClient()` dispatches on the shape of the id; the store stays
DCR-only.

#### Consent is required

`clientIdMetadataDocuments.enabled` **forces `consent.enabled` on**, because the
"MUST clearly display the redirect URI hostname" above cannot be satisfied without
a screen. Setting `consent: { enabled: false }` together with CIMD **throws at
bootstrap** rather than being ignored — a security property silently missing is
worse than a boot failure that names it.

#### What is validated

Every failure is an HTTP `400` naming the reason, and the authorization request is
aborted (*"if the authorization server fails to retrieve the client metadata
document, it SHOULD abort the authorization request"*).

On the `client_id` URL, before anything is fetched:

| Rule | Notes |
|---|---|
| `https` scheme | unless [`allowInsecureClientIdScheme`](#development-only-escape-hatch) |
| has a path component | `https://example.com` and `https://example.com/` are both refused |
| no `.` / `..` segments | checked on the **raw string**: WHATWG URL parsing silently collapses them |
| no fragment | |
| no userinfo | |
| a port is fine | |
| a query string warns | a client-side SHOULD NOT, not a server-side MUST; harmless because the document's own `client_id` still has to match the whole URL |

On the response and the document:

- `200` only. A `3xx` is a failure: **redirects are not followed**, because each
  hop would need the SSRF guard re-run against a target the client gets to choose
  after its URL was already vetted.
- Body capped at `maxDocumentBytes` (default **5120** — *"the recommended maximum
  response size for client metadata documents is 5 kilobytes"*), enforced while
  streaming and against `Content-Length`. Requests are sent with
  `Accept-Encoding: identity` so a compressed bomb cannot slip past a wire-byte cap.
- One hard deadline of `timeoutMs` (default 5000) over connect *and* read.
- Valid JSON, and a JSON **object**.
- `client_id` matched by **simple string comparison** (RFC 3986 §6.2.1) against the
  id the client sent — no normalization, no case folding. This equality is the
  entire binding between "the URL we fetched" and "the identity we are about to
  grant", so it fails closed: a document whose `client_id` differs only by a
  default port or host case is rejected.
- `client_name` non-empty; `redirect_uris` a non-empty array of strings.
- The **authorization request's `redirect_uri` must be one of them**, matched
  exactly.
- No `client_secret` / `client_secret_expires_at`, and not
  `client_secret_post` / `client_secret_basic` / `client_secret_jwt` — a shared
  secret cannot be established with an identity that is a public URL.
- `token_endpoint_auth_method` must be `none` (absent counts as `none`).
  **`private_key_jwt` is rejected at `/authorize`** with a "not supported"
  message: it is legal in a CIMD document but unimplemented here, and accepting
  the document only to fail at `/token` would hand the client a code it can never
  redeem *after* the user had already consented. JWKS fetching and JWT-assertion
  verification are not implemented.

#### SSRF guard

*"The authorization server takes a URL as input from an unknown client and fetches
that URL. A malicious client could use this to trigger the authorization server to
make requests to arbitrary URLs, such as requests to private administration
endpoints."*

The guard is not advisory:

1. **DNS is resolved first**, and *every* address in the answer must be publicly
   routable — a hostname with one public and one private `A` record is refused
   outright rather than cherry-picked. Rejecting only IP *literals* would miss the
   whole attack, which is a normal-looking name with a `127.0.0.1` record.
2. **The connection is pinned** to the vetted address (via the HTTP agent's
   `lookup` hook), so there is no DNS-rebinding window between the check and the
   connect.
3. Refused space, in both families and including the IPv4-mapped IPv6 spellings:
   loopback, RFC 1918, link-local (`169.254/16`, `fe80::/10`), CGNAT
   (`100.64/10`), unique-local (`fc00::/7`), unspecified, multicast and reserved.
   Anything that fails to parse is treated as non-routable — the guard fails
   closed.

#### Caching

Resolved documents are held in a **bounded in-process LRU** (`maxCacheEntries`,
default 256), honouring a deliberately small subset of RFC 9111: `no-store` /
`no-cache` suppress caching, `s-maxage` then `max-age` set the lifetime, `Expires`
is the fallback, `cacheTtlMs` (default 5 min) applies when the origin says
nothing, and everything is clamped to 24 hours so an origin cannot pin a stale
identity in memory.

**Nothing negative is ever cached**: *"the authorization server MUST NOT cache
error responses. The authorization server also MUST NOT cache documents which are
invalid or malformed."* Failures throw before the cache is written, so a client
that fixes its document is served correctly on its very next request.

Documents are **not** written to the `IOAuthStore`, and no store method was added:
a document is an HTTP cache entry with mandated invalidation, not a durable
registration, and `IOAuthStore` is public API whose custom implementations would
all break. The consequence is that the cache is **per replica** — N replicas fetch
a given document up to N times and expire it independently. Correctness is
unaffected (every entry is fully re-validated on every fetch), only fetch volume.

#### Snapshotting

The document resolved at `/authorize` is snapshotted onto the OAuth session and
then onto the authorization code (`AuthorizationCode.client_metadata`). The token
endpoint validates client authentication against that snapshot rather than
re-fetching, which pins the redemption to the metadata the user actually
consented to: a document that swaps its `redirect_uris` or
`token_endpoint_auth_method` after the code was issued cannot retroactively change
how that code is redeemed, and redemption does not depend on the client's origin
still being reachable.

A **refresh_token** grant has no such snapshot, so it re-resolves the document
(normally a cache hit). A CIMD client whose document has become permanently
unreachable cannot refresh, and must run the authorization flow again.

#### Development-only escape hatch

```typescript
clientIdMetadataDocuments: {
  enabled: true,
  allowInsecureClientIdScheme: true, // ⚠️ NEVER in production
}
```

This accepts `http://` `client_id` URLs **and disables the SSRF guard's
private/loopback refusal** — both are needed to serve a document from
`http://localhost:<port>` without TLS, which is what
`examples/built-in-authorization-server` does. With it on, an unauthenticated
caller can make the server fetch `https://169.254.169.254/...` (the cloud
instance-metadata endpoint). It logs a warning at bootstrap and defaults to
`false`.

> **TypeORM users:** the snapshot adds nullable `simple-json` columns
> `client_metadata` on `rekog_mcp_auth_authorization_codes` and `clientMetadata`
> (plus `consentPending`, `userId`, `userProfileId` for the consent step) on
> `rekog_mcp_auth_sessions`. With `synchronize: true` they appear automatically;
> migration-managed deployments need the matching `ADD COLUMN`s. They are only
> populated for CIMD clients and pending consent respectively, so existing rows
> keep `NULL`.

#### Runnable demo

`examples/built-in-authorization-server` has a copy-pasteable walkthrough of both
features — consent screen, loopback warning, a metadata document served locally,
and the rejection cases — behind the opt-in `MCP_CONSENT`, `MCP_CIMD` and
`MCP_FAKE_IDP` flags. See its
[README](../examples/built-in-authorization-server/README.md).

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
- **GET** `/auth/callback` - OAuth callback endpoint. Answers with the [consent screen](#consent-screen) instead of redirecting when consent is enabled
- **POST** `/auth/consent` - Consent decision *[only registered when `consent.enabled` resolves to `true`](#consent-screen)*
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
4. **The app refuses to start, naming `cookie-parser`**: `app.use(cookieParser())`
   is missing. `/auth/authorize` sets the `oauth_session` / `oauth_state`
   cookies and the callback reads them back off `req.cookies`, which Express
   only populates when `cookie-parser` is mounted — and `McpAuthModule` cannot
   register the middleware for you, since middleware belongs to your bootstrap.
   A server that cannot complete the handshake should not accept traffic, so
   this fails at boot rather than on the callback of the first user who tries to
   log in. If you populate `req.cookies` by some other means — a wrapped or
   re-exported cookie-parser, `@fastify/cookie` — the check cannot see it by
   name; set `skipCookieParserCheck: true` to opt out.
5. **Cookies not sent back**: the IdP's redirect URI host must match
   `serverUrl` exactly — cookies set on `localhost` are not sent to
   `127.0.0.1`.
