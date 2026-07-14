# MCP authentication with a self-hosted external OAuth 2.1 server (Casdoor)

This is a self-contained project. It runs **[Casdoor](https://casdoor.org) as a
full external OAuth 2.1 / OIDC authorization server** in Docker, with an
**MCP-Nest server acting as a pure OAuth resource server**. The MCP server
exposes a tiny greeting capability and accepts only requests that carry a valid
Casdoor-issued access token.

The architectural point worth internalizing:

> The authorization server owns the **entire** identity story — user **login**,
> the OAuth **consent** screen, and **Dynamic Client Registration**. The MCP
> server contains **no** login or consent code. It only validates tokens.

Casdoor has a built-in login page **and** consent screen **and** RFC 7591
Dynamic Client Registration, so none of those live in the resource server. The
resource server is just a resource server. If you already run your own issuer
(Keycloak, Auth0, Okta) you don't need the bundled Casdoor — keep only the
resource-server half here (the `CasdoorAuthGuard` JWKS-validation pattern),
pointed at your issuer instead.

## Architecture

```
                         ┌───────────────────────────────────────────┐
                         │ docker compose (single container)         │
  ┌────────────┐         │   ┌─────────────────────────────────────┐ │
  │ MCP client │         │   │ Casdoor :8000                        │ │
  │ (Inspector │         │   │  OAuth 2.1 AS + OIDC                 │ │
  │  / script) │         │   │  • login UI   • consent UI          │ │
  └─────┬──────┘         │   │  • DCR (RFC 7591)  • JWKS (RS256)    │ │
        │                │   │  SQLite (no extra DB container)      │ │
        │                │   └─────────────────────────────────────┘ │
        │                └───────────────────────────────────────────┘
        │ 1. POST /mcp (no token) ──▶ resource server
        │ ◀── 401 + WWW-Authenticate: resource_metadata=...
        │
        │ 2. GET /.well-known/oauth-protected-resource/mcp ──▶ MCP-Nest
        │ ◀── { authorization_servers: ["http://localhost:8000"] }
        │
        │ 3. discover + DCR + login + consent + token ─────▶ Casdoor :8000
        │ ◀── access_token (RS256 JWT)
        │
        │ 4. POST /mcp  Authorization: Bearer <token> ─────▶ ┌─────────────┐
        │ ◀── tool result                                    │ MCP-Nest    │
        └────────────────────────────────────────────────── │ :3030 /mcp  │
                                                             │ (resource)  │
                                                             └─────────────┘
```

- **Casdoor** issues access tokens (RS256 JWTs), hosts the login + consent
  screens, and exposes the OAuth 2.1 / OIDC endpoints (authorize, token,
  dynamic client registration, RFC 8414 / OIDC discovery, JWKS).
- **MCP-Nest** (`src/main.ts`) runs as a `McpStrategy` microservice with
  `StreamableHttpTransport`. The `/mcp` route is a real NestJS controller
  (`McpHttpController`, which extends `McpHttpControllerFor(mcpTransport)`), and a
  NestJS guard (`CasdoorAuthGuard`) validates the Bearer token against Casdoor's
  **published JWKS** — no shared secret. A `WellKnownController` serves the RFC
  9728 protected-resource metadata pointing at Casdoor.

  > **Why a guard, not middleware?** Authenticating with a guard on a real
  > controller is the idiomatic NestJS way: `@UseGuards(CasdoorAuthGuard)` covers
  > the whole MCP surface in one place and composes with interceptors, filters and
  > versioning. Middleware would be the only option if you let the transport
  > self-mount its route (`mount: true`) — a Nest guard then has nothing to attach
  > to. Here the controller owns the `/mcp` route instead:
  > `McpHttpControllerFor(mcpTransport)` reads `mcpTransport.httpHandlers` at
  > class-definition time, which auto-disables the transport's own self-mount, so
  > there's no double-registration and no `mount: false` flag to remember — and a
  > guard is exactly the right tool.

```mermaid
sequenceDiagram
  participant C as MCP Client
  participant K as Casdoor (:8000)
  participant N as NestJS app (:3030)
  C->>N: POST /mcp (no token)
  N-->>C: 401 + WWW-Authenticate (resource_metadata)
  C->>N: GET /.well-known/oauth-protected-resource/mcp
  N-->>C: { authorization_servers: [Casdoor] }
  C->>K: GET /.well-known/openid-configuration
  K-->>C: authorize / token / registration / jwks endpoints
  C->>K: POST /api/oauth/register (DCR, RFC 7591)
  K-->>C: { client_id }
  C->>K: GET /login/oauth/authorize (PKCE S256)
  Note over K: Casdoor renders LOGIN + CONSENT (its own UI)
  K-->>C: 302 -> client redirect_uri?code=...
  C->>K: POST /api/login/oauth/access_token (code + verifier)
  K-->>C: access_token (RS256)
  C->>N: POST /mcp (Bearer)
  N->>K: (first request) GET /.well-known/jwks
  N-->>C: tool result
```

## What makes Casdoor work as the MCP authorization server

Everything is configured declaratively so the stack boots ready-to-use:

| Piece | Where | Purpose |
|---|---|---|
| `dcrPolicy: "open"` on the `built-in` org | `casdoor/init_data.json` | Enables RFC 7591 Dynamic Client Registration (off by default) |
| `defaultApplication: "app-built-in"` | `casdoor/init_data.json` | DCR-created apps inherit Password sign-in + branding from it |
| `hasPrivilegeConsent: true` | `casdoor/init_data.json` | Lets the seed add users to the `built-in` org |
| `app-built-in` with fixed `clientId`/`clientSecret` | `casdoor/init_data.json` | Stable creds for the non-interactive `client_credentials` token script |
| `origin` / `originFrontend = http://localhost:8000` | `casdoor/conf/app.conf` | Makes discovery advertise `authorize` on `:8000` (else Casdoor defaults to `:7001`) |
| SQLite (`driverName = sqlite`) | `casdoor/conf/app.conf` | Single container, no separate database |

Endpoints Casdoor exposes (discover them at
`http://localhost:8000/.well-known/openid-configuration`):

- `GET  /.well-known/openid-configuration` — OIDC / RFC 8414 metadata
- `GET  /.well-known/jwks` — RS256 public keys (the resource server validates with these)
- `POST /api/oauth/register` — dynamic client registration (RFC 7591)
- `GET  /login/oauth/authorize` — authorization code + PKCE (renders login + consent)
- `POST /api/login/oauth/access_token` — token endpoint

> Requires a Casdoor build with the DCR endpoint (`/api/oauth/register`) and
> per-organization `dcrPolicy`. This example uses `casbin/casdoor:latest`;
> pin a specific tag/digest in `docker-compose.yml` for reproducibility.

### Seeded accounts (dev only)

| Who | Username / Password | Notes |
|---|---|---|
| Demo user | `joe` / `password123` | Use this to log in during the browser flow |
| Casdoor admin | `admin` / `admin123` | Casdoor console at http://localhost:8000 |
| OAuth client (for the token script) | clientId `mcp-example-client`, secret `mcp-example-secret-dev-only` | `app-built-in`, `client_credentials` grant |

## Prerequisites

- Docker + Docker Compose
- Ports free on the host: **8000** (Casdoor), **3030** (MCP).
  If `8000` is taken, see [Port conflicts](#port-conflicts).

## Run it (happy path)

All commands are run from this directory:

```bash
cd examples/external-authorization-server-casdoor
npm install
```

**1. Start Casdoor and wait until it answers**

```bash
docker compose up -d

# wait for the OIDC discovery document to be served
until curl -sf http://localhost:8000/.well-known/openid-configuration >/dev/null; do
  echo "waiting for Casdoor..."; sleep 2
done
echo "Casdoor is ready"
```

**2. Sanity-check the OAuth 2.1 server**

```bash
# OIDC metadata (note registration_endpoint => DCR is available)
curl -s http://localhost:8000/.well-known/openid-configuration | jq \
  '{authorization_endpoint, token_endpoint, registration_endpoint, jwks_uri}'

# Dynamic Client Registration returns a client_id
curl -s -X POST http://localhost:8000/api/oauth/register \
  -H 'Content-Type: application/json' \
  -d '{"client_name":"demo","redirect_uris":["http://localhost:6274/oauth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"none","application_type":"native"}' | jq
```

**3. Start the MCP server (resource server)** — in a second terminal:

```bash
cd examples/external-authorization-server-casdoor
npm start
# MCP endpoint: http://localhost:3030/mcp  (Bearer required)
```

**4. Mint a token and call a tool (non-interactive)**

```bash
# client_credentials grant against app-built-in -> a Casdoor RS256 JWT
./scripts/get-token.sh

# Call the greeting tool with the token:
ACCESS_TOKEN=$(./scripts/get-token.sh) npm run call
```

Expected output:

```
Connected to http://localhost:3030/mcp
Available tools: greet-world, greet-user
greet-world result: "Hello, World!"
```

**5. Confirm auth is actually enforced**

```bash
# No token => 401 with a discovery hint
curl -s -i -X POST http://localhost:3030/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}' \
  | grep -E 'HTTP/|WWW-Authenticate'
# => HTTP/1.1 401 Unauthorized
# => WWW-Authenticate: Bearer resource_metadata="http://localhost:3030/.well-known/oauth-protected-resource/mcp"
```

**6. Tear down**

```bash
docker compose down        # the SQLite db lives in ./casdoor/data (gitignored)
```

## The full interactive OAuth flow (with the MCP Inspector)

There is **nothing to render here** — Casdoor hosts the login and consent
screens. With the stack up (step 1) and the MCP server running (step 3):

```bash
npx @modelcontextprotocol/inspector
```

1. Set **Transport** to *Streamable HTTP* and **URL** to `http://localhost:3030/mcp`.
2. Click **Connect** → **Open OAuth flow**. The Inspector does DCR against
   Casdoor (`POST /api/oauth/register`) and starts the authorization-code flow.
3. A browser tab opens **Casdoor's** login page. Sign in as **`joe` /
   `password123`**, then approve on **Casdoor's** consent screen.
4. The Inspector receives the code, exchanges it at Casdoor's token endpoint, and
   connects. Call `greet-world` → `"Hello, World!"`, or `greet-user` with
   `{"name":"joe","language":"en"}`.

## How the resource server validates tokens

`CasdoorAuthGuard` (sharing its verification with `casdoor-token.ts`) fetches
Casdoor's JWKS once and verifies every Bearer token's **signature (RS256)**,
**issuer**, and **expiry**. There is no shared secret between the AS and the
resource server. On a missing/invalid token the guard returns `401` with a
`WWW-Authenticate` header pointing at the protected-resource metadata.

> **Audience note (RFC 8707):** Casdoor sets the token `aud` to the OAuth
> *client_id*, not the MCP resource URL that the MCP spec would like to see in
> `aud`. So this example does **not** enforce an audience — it trusts any
> validly-signed, unexpired token from the configured issuer. To tighten this,
> configure Casdoor token customization to emit the resource URL as the audience
> and pass `audience` to `verifyCasdoorToken` in `casdoor-auth.guard.ts`.

## Files

| File | Role |
|---|---|
| `docker-compose.yml` | Casdoor (OAuth 2.1 AS + DCR), SQLite, single container |
| `casdoor/conf/app.conf` | Casdoor backend config (SQLite + public URLs + seed file) |
| `casdoor/init_data.json` | Declarative seed: `built-in` org (DCR on), `app-built-in`, users |
| `casdoor/data/` | Runtime SQLite db + logs (gitignored; re-seeded each boot) |
| `src/mcp.runtime.ts` | The `StreamableHttpTransport` + `McpStrategy` instances |
| `src/mcp.controller.ts` | `McpHttpController extends McpHttpControllerFor(mcpTransport)` — the guarded `/mcp` route |
| `src/casdoor-auth.guard.ts` | NestJS guard: validates Casdoor RS256 tokens; emits `WWW-Authenticate` on 401 |
| `src/casdoor-token.ts` | Shared JWKS verification used by the guard |
| `src/greeting.tool.ts` | Self-contained `@McpController()`: `greet-world` + `greet-user` |
| `src/well-known.controller.ts` | RFC 9728 protected-resource metadata (points at Casdoor) |
| `src/app.module.ts` | Controllers (incl. `McpHttpController`) + guard |
| `src/main.ts` | Bootstrap: adapter → microservice → listen (no auth middleware) |
| `scripts/get-token.sh` | Mints a Casdoor token via `client_credentials` |
| `scripts/call-tool.ts` | Minimal MCP client that calls `greet-world` with a Bearer token |

Configurable via env: `PORT` (3030), `SERVER_URL`, `CASDOOR_URL` (8000),
`CASDOOR_HOST_PORT` (compose), `CLIENT_ID` / `CLIENT_SECRET` (token script).

## Troubleshooting

### Port conflicts
If host port `8000` is taken, run Casdoor on another port and point the MCP
server at it:

```bash
CASDOOR_HOST_PORT=8001 docker compose up -d
# NOTE: also set `origin`/`originFrontend` in casdoor/conf/app.conf to
# http://localhost:8001 so discovery advertises the right port, then:
CASDOOR_URL=http://localhost:8001 npm start
CASDOOR_URL=http://localhost:8001 ./scripts/get-token.sh
```

The MCP server also honors `PORT` (default `3030`), so run it on another port
with `PORT=3131 npm start` (the client script reads `PORT`/`SERVER_URL` too).

### DCR returns `dynamic client registration is disabled for this organization`
The `built-in` org needs `dcrPolicy: "open"` (set in `casdoor/init_data.json`).
The seed is applied on every boot; if you edited it, recreate the stack:
`docker compose down && docker compose up -d`.

### Reset all Casdoor state
State is re-seeded from `init_data.json` on each boot, but to wipe the SQLite db
entirely:

```bash
docker compose down
rm -f casdoor/data/casdoor.db
docker compose up -d
```
