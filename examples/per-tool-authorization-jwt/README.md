# per-tool-authorization-jwt

Runnable check for `docs/per-tool-authorization-jwt.md`: a hand-rolled JWT
guard (`src/simple-jwt.guard.ts`) sets `req.user`, and the built-in
`ToolAuthorizationService` enforces `@PublicTool`/`@ToolScopes`/`@ToolRoles`
on the tools in `src/my-tools.ts`.

## Run

```bash
npm install
PORT=3012 npm start
```

## Mint test JWTs

```bash
npx ts-node scripts/mint-jwts.ts > /tmp/jwts.sh
source /tmp/jwts.sh
```

This prints `export BASIC_USER=...`, `ADMIN_USER`, `PREMIUM_USER`,
`SUPERADMIN_USER` — same shape as the doc's pre-minted tokens, signed with the
guard's default `JWT_SECRET`.

## Test with MCP Inspector

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3012/mcp \
  --transport http --method tools/list

bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3012/mcp \
  --transport http --method tools/call --tool-name admin-greet \
  --tool-arg message=hi --header "Authorization: Bearer $ADMIN_USER"
```
