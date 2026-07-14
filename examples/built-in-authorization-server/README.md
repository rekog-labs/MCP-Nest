# built-in-authorization-server

Greenfield verification of `docs/built-in-authorization-server.md` against the
published alpha packages (`@rekog/mcp-nest@2.0.0-alpha.1`,
`@rekog/mcp-nest-auth@2.0.0-alpha.1`).

The `McpAuthModule` mounts the OAuth 2.1 controllers (discovery, dynamic client
registration, authorize/callback/token) while MCP itself runs as a `McpStrategy`
microservice. The `/mcp` transport route is protected by Express middleware that
validates the Bearer JWT with the module's `JwtTokenService` and sets `req.user`.

## Install & run

```bash
npm install
PORT=3014 MCP_FAKE_AUTH=1 npm start   # FAKE mode (offline)
```

Server URL is `http://localhost:3014`; `apiPrefix` is `auth`.

## Two modes

### REAL mode
Provide real provider credentials in the environment and the real GitHub
provider is wired exactly as documented:

```bash
GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy JWT_SECRET=<32+ chars> PORT=3014 npm start
```

The interactive browser leg (`/auth/authorize` → GitHub → `/auth/callback`)
requires a live GitHub App and is only exercised in this mode.

### FAKE mode (offline, `MCP_FAKE_AUTH=1`)
When `MCP_FAKE_AUTH=1` is set and no real credentials are present, dummy
`clientId`/`clientSecret` are supplied so the module constructs without ever
contacting an IdP. Every offline-reachable feature works:

- Discovery: `/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource`
- Dynamic Client Registration (RFC 7591): `POST /auth/register`
- PKCE advertised (`code_challenge_methods_supported: ["plain","S256"]`)
- JWT validation of locally-signed tokens by the `/mcp` middleware
- Guarded MCP calls with a locally-minted JWT

Mint a local token (signed with the same `jwtSecret`, so `validateToken` accepts
it without any IdP call):

```bash
TOKEN=$(npx ts-node scripts/mint-jwt.ts)
bunx @modelcontextprotocol/inspector --cli http://localhost:3014/mcp \
  --transport http --header "Authorization: Bearer $TOKEN" --method tools/list
```

The `authorize → callback` interactive leg genuinely needs the external IdP and
is **not verified offline**.

## What was verified (FAKE mode)

- Discovery JSON shape matches the doc.
- `POST /auth/register` returns a registered client (`client_id`).
- PKCE methods advertised.
- `/mcp` accepts a valid locally-minted JWT (`whoami` → `Hello, Ada Lovelace!`),
  rejects missing / malformed / wrong-secret tokens with `401`.
- `disableEndpoints` disables a discovery route (→ `404`) while keeping the other.
- `@McpUser()` projects `req.user`.
