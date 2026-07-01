# per-tool-authorization

Greenfield verification project for `docs/per-tool-authorization.md`, built
against the published `@rekog/mcp-nest@2.0.0-alpha.1` (no local repo source,
no `@rekog/mcp-nest-auth`).

## What this is

- `src/tools.controller.ts` — the exact tool set from the doc's "Define
  Tools" code sample: `public-search` (`@PublicTool()`), `user-profile`
  (protected, reads `req.user` via `@McpRawRequest()`), `admin-delete`
  (`@ToolScopes(['admin', 'write'])`), `system-config`
  (`@ToolRoles(['admin'])`).
- `src/auth.guard.ts` — a NestJS `AuthGuard` (`CanActivate`) applied to the
  MCP controller with `@UseGuards(AuthGuard)`. It verifies a `Bearer <jwt>`
  header locally with `jsonwebtoken` and a hardcoded dev secret and, if
  valid, sets `req.user` to the decoded payload. A tokenless request is let
  through with no `req.user` when `FREEMIUM=true` (freemium) and rejected
  otherwise; an invalid token is always rejected — no external IdP involved
  anywhere.
- `src/main.ts` — HTTP entrypoint (stateful Streamable HTTP). Mounts the MCP
  route as an `McpHttpControllerFor` controller guarded by `AuthGuard`, and
  reads `FREEMIUM=true|false` from the environment into
  `allowUnauthenticatedAccess` on `McpStrategy` (the guard imports the same
  value so the two stay in step).
- `src/main-stdio.ts` — same tools over STDIO, to check the doc's "STDIO
  Mode" claim.
- `src/mint-token.ts` — mints a local JWT for one of three profiles
  (`admin`, `basic`, `premium`), signed with the same dev secret the
  middleware verifies against.

## Minting local test JWTs

```bash
npx ts-node --transpile-only src/mint-token.ts admin    # scopes: admin,write,read · roles: admin,user
npx ts-node --transpile-only src/mint-token.ts basic    # scopes: read            · roles: user
npx ts-node --transpile-only src/mint-token.ts premium  # scopes: read,premium    · roles: user
```

## Run

```bash
PORT=3011 npm start                    # standard mode (allowUnauthenticatedAccess=false, the default)
PORT=3011 FREEMIUM=true npm start      # freemium mode (allowUnauthenticatedAccess=true)
npx ts-node --transpile-only src/main-stdio.ts   # STDIO mode
```

## Test with MCP Inspector CLI

```bash
TOKEN=$(npx ts-node --transpile-only src/mint-token.ts admin)
bunx @modelcontextprotocol/inspector --cli http://localhost:3011/mcp --transport http \
  --header "Authorization: Bearer $TOKEN" --method tools/list

bunx @modelcontextprotocol/inspector --cli --transport stdio -- \
  npx ts-node --transpile-only src/main-stdio.ts --method tools/list
```

See the shared report (`.rinorism/doc-report.md`) for the full access-matrix
results and the discrepancies found against the doc's text.
