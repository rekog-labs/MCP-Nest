# External Authorization Server: Casdoor (runnable, with DCR + consent)

Most "external authorization server" setups assume the OAuth server already
exists somewhere and you only wire up token validation. This guide is different:
it runs a **complete, self-hosted OAuth 2.1 / OIDC authorization server**
([Casdoor](https://casdoor.org)) in Docker, and treats the MCP-Nest server as a
**pure resource server** that does nothing but validate Bearer tokens.

The point to internalize:

> The authorization server owns the **entire** identity story — user **login**,
> the OAuth **consent** screen, and **Dynamic Client Registration** (RFC 7591).
> The MCP server contains **no** login, consent, or token-issuing code. It only
> validates tokens.

There is a runnable project for this guide:
[`examples/external-authorization-server-casdoor/`](../examples/external-authorization-server-casdoor/).
It boots Casdoor with a declarative seed (org, app, users, DCR enabled), starts
the MCP resource server, and includes scripts to mint a token and call a tool.

## When to reach for this

- **This guide (Casdoor):** you want a *runnable* external AS — with a hosted
  login page, a consent screen, and RFC 7591 Dynamic Client Registration — so
  MCP clients (Claude, VS Code, the Inspector) can register themselves on the
  fly and walk a user through an interactive OAuth flow, all without any
  auth/consent UI living in your MCP server.
- **Already have an issuer** (Keycloak, Auth0, Okta, a corporate IdP) and only
  need the MCP server to validate its JWTs? You don't need to run Casdoor — keep
  just the resource-server half of this guide: the same `CasdoorAuthGuard`
  pattern (a guard that verifies tokens against the issuer's JWKS), pointed at
  your own issuer instead of the bundled one.
- **The [built-in authorization server](./built-in-authorization-server.md):**
  your authorization server is **not** MCP-spec compliant, so you want
  `mcp-nest-auth` (`McpAuthModule`) to run the MCP authorization flow — dynamic
  client registration, consent, token issuance — and delegate only *user
  authentication* to an existing IdP (GitHub, Google, …). This external-server
  guide is the opposite case: the server already speaks the MCP auth spec, so no
  `mcp-nest-auth` is needed.

## How the resource server is wired

The MCP server runs as an `McpStrategy` microservice with
`StreamableHttpTransport`. Two things make it a resource server and nothing more:

1. **A guarded `/mcp` controller.** The route is a real NestJS controller that
   extends `McpHttpControllerFor(mcpTransport)`, with `@UseGuards(CasdoorAuthGuard)`:

   ```typescript
   @Controller('mcp')
   @UseGuards(CasdoorAuthGuard)
   export class McpHttpController extends McpHttpControllerFor(mcpTransport) {}
   ```

   Binding the controller to the transport reads `mcpTransport.httpHandlers` at
   class-definition time, which auto-disables the transport's own self-mount — so
   the controller owns `/mcp` and the guard covers the whole MCP surface in one
   place. (A guard is idiomatic here precisely because there is a controller to
   attach to. Middleware would only be needed if you let the transport
   self-mount its route.)

2. **RFC 9728 protected-resource metadata.** A `WellKnownController` advertises
   the authorization server so clients can discover it:

   ```typescript
   @Controller('.well-known')
   export class WellKnownController {
     @Get('oauth-protected-resource/mcp')
     getProtectedResourceForMcp() {
       return {
         resource: 'http://localhost:3030/mcp',
         authorization_servers: ['http://localhost:8000'], // Casdoor
         jwks_uri: 'http://localhost:8000/.well-known/jwks',
         bearer_methods_supported: ['header'],
         scopes_supported: ['openid', 'profile', 'email'],
       };
     }
   }
   ```

## Token validation via JWKS

Casdoor signs access tokens with **RS256** and publishes the matching public
keys at its JWKS endpoint. The guard fetches that JWKS once (via `jose`'s
`createRemoteJWKSet`, which caches and refreshes) and verifies every token's
**signature**, **issuer**, and **expiry** — there is no shared secret between the
authorization server and the resource server. On a missing or invalid token it
returns `401` with a `WWW-Authenticate` header pointing back at the
protected-resource metadata:

```
WWW-Authenticate: Bearer resource_metadata="http://localhost:3030/.well-known/oauth-protected-resource/mcp"
```

> **Audience note (RFC 8707):** Casdoor sets the token `aud` to the OAuth
> *client_id*, not the MCP resource URL the spec would prefer. So the example
> does not enforce an audience by default — it trusts any validly-signed,
> unexpired token from the configured issuer. To tighten it, configure Casdoor to
> emit the resource URL as the audience and pass `audience` to the verifier.

## The discovery hop

The metadata endpoint is what turns "here is a token" into a full,
zero-preconfiguration OAuth flow:

1. Client `POST /mcp` with no token → `401` + `WWW-Authenticate` (discovery hint).
2. Client `GET /.well-known/oauth-protected-resource/mcp` → learns the
   `authorization_servers` (Casdoor).
3. Client `GET <Casdoor>/.well-known/openid-configuration` → discovers the
   authorize / token / **registration** (DCR) / jwks endpoints.
4. Client registers itself (RFC 7591), logs the user in and gets consent on
   **Casdoor's** hosted pages, and exchanges the code for an access token.
5. Client `POST /mcp` with `Authorization: Bearer <token>` → the guard validates
   it against Casdoor's JWKS and the tool runs.

None of steps 3–4 touch the MCP server — that is the whole point.

## Try it

```bash
cd examples/external-authorization-server-casdoor
npm install
docker compose up -d          # Casdoor on :8000 (login + consent + DCR + JWKS)
npm start                     # MCP resource server on :3030/mcp

# non-interactive: mint a token and call a tool
ACCESS_TOKEN=$(./scripts/get-token.sh) npm run call
# => greet-world result: "Hello, World!"
```

For the full interactive flow (DCR + Casdoor login + consent in the browser),
point the MCP Inspector at `http://localhost:3030/mcp` and open the OAuth flow.
The project [README](../examples/external-authorization-server-casdoor/README.md)
has the complete walkthrough, the seed accounts, and troubleshooting.
