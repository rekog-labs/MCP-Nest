# per-tool-authorization-oauth

Greenfield verification of [`docs/per-tool-authorization-oauth.md`](../../docs/per-tool-authorization-oauth.md)
against the published alpha packages (`@rekog/mcp-nest@2.0.0-alpha.1`,
`@rekog/mcp-nest-auth@2.0.0-alpha.1`).

It wires `McpAuthModule` (the OAuth 2.1 authorization server) + `McpAuthJwtGuard`
on an `McpHttpControllerFor(...)` controller, exactly as the doc shows, and adds
sample tools decorated with `@PublicTool()` / `@ToolScopes()` / `@ToolRoles()`.

## Two auth modes

The wiring is identical in both modes; only how the caller gets a JWT differs.

- **REAL mode** — set real GitHub credentials and the module runs the full
  documented OAuth handshake (GitHub login → minted JWT):

  ```bash
  GITHUB_CLIENT_ID=xxx GITHUB_CLIENT_SECRET=yyy \
  JWT_SECRET=your_super_secret_jwt_key_at_least_32_chars \
  SERVER_URL=http://localhost:3013 PORT=3013 npm start
  ```

- **FAKE mode (offline, no external network)** — set `MCP_FAKE_AUTH=1`. The module
  is wired with dummy provider credentials (GitHub is only contacted during
  `/auth/authorize`, which is never hit), and identity comes from locally minted
  HS256 JWTs signed with the same `jwtSecret` the module validates against. On
  boot the server prints a ready-to-use Bearer token for BASIC / ADMIN / PREMIUM /
  SUPERADMIN test users covering the whole scope/role matrix:

  ```bash
  PORT=3013 MCP_FAKE_AUTH=1 npm start
  ```

`ALLOW_UNAUTHENTICATED_ACCESS=true` turns on freemium (tokenless callers reach
`@PublicTool()` tools only). Defaults to strict (tokenless → 401).

`npm run mint` prints the fake tokens as `export` lines without booting the server.

## What each env var controls

| Env var | Effect |
|---|---|
| `PORT` | Listen port (also default `SERVER_URL`/`resource` host). |
| `MCP_FAKE_AUTH=1` | Offline mode: dummy provider creds + locally minted JWTs. Ignored if real GitHub creds are present. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | REAL mode: wires the real GitHub provider. |
| `JWT_SECRET` | HS256 secret (≥32 chars). Defaults to a fixed dev secret in FAKE mode. |
| `SERVER_URL` | Authorization-server base URL. Defaults to `http://localhost:$PORT`. |
| `ALLOW_UNAUTHENTICATED_ACCESS=true` | Freemium: tokenless callers may use `@PublicTool()` tools. |

## Verified offline (FAKE mode, port 3013)

- Discovery: `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server` return correct metadata;
  `/auth/register`, `/auth/authorize`, `/auth/token` are mounted.
- Strict mode: tokenless `/mcp` → `401 Access token required`.
- `tools/list` filtering and `tools/call` enforcement match the scope/role matrix
  for BASIC / ADMIN / PREMIUM / SUPERADMIN, including `req.user` enrichment
  (`displayName`).
- Freemium: tokenless caller sees only `public-greet-world`; protected tools are
  filtered/rejected; an invalid token is still rejected (401).

The live GitHub handshake (`/auth/authorize` redirect → `/auth/callback` →
`/auth/token`) requires a real IdP and is not exercised offline.
