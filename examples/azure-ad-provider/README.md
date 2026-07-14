# azure-ad-provider

Greenfield verification of `docs/azure-ad-provider.md` against the published
alpha packages (`@rekog/mcp-nest@2.0.0-alpha.1`,
`@rekog/mcp-nest-auth@2.0.0-alpha.1`).

It wires the `AzureADOAuthProvider` into `McpAuthModule.forRoot(...)` exactly as
the doc shows, runs MCP as a microservice `McpStrategy` with a
`StreamableHttpTransport`, and gates `/mcp` with the Bearer-JWT middleware
(`JwtTokenService.validateToken`) described in the doc.

## Install

```bash
npm install --no-fund --no-audit
```

`passport-azure-ad-oauth2` is a direct dependency of `@rekog/mcp-nest-auth`, so
it is pulled in automatically. `@nestjs/jwt`, `@nestjs/passport`, `typeorm`, and
`@nestjs/typeorm` are peer deps of the auth package and are listed here too.

## Two run modes

### REAL mode (needs a live Azure AD / Entra ID tenant)

Provide real credentials, then start:

```bash
export AZURE_AD_CLIENT_ID=...           # Application (client) ID
export AZURE_AD_CLIENT_SECRET=...       # client secret value
export JWT_SECRET=...                   # >= 32 chars
export SERVER_URL=http://localhost:3017
PORT=3017 npm start
```

The interactive login (`/auth/authorize` -> Microsoft -> `/auth/callback`)
requires the live tenant and is not exercised offline.

### FAKE mode (offline, no Azure required)

`MCP_FAKE_AUTH=1` boots the server with dummy Azure creds and a known
`JWT_SECRET`, so discovery + guarded MCP calls work fully offline:

```bash
PORT=3017 MCP_FAKE_AUTH=1 npm start
```

Mint a locally-signed token the middleware accepts (HS256, signed with the same
`JWT_SECRET`; `validateToken` only checks the signature):

```bash
JWT_SECRET='fake-jwt-secret-at-least-32-characters-long' npm run mint
```

Then:

```bash
curl -s http://localhost:3017/.well-known/oauth-authorization-server | jq .
curl -s http://localhost:3017/.well-known/oauth-protected-resource | jq .

TOKEN=$(JWT_SECRET='fake-jwt-secret-at-least-32-characters-long' npm run --silent mint)
bunx @modelcontextprotocol/inspector --cli http://localhost:3017/mcp \
  --transport http --header "Authorization: Bearer $TOKEN" \
  --method tools/list | jq '.tools[].name'
```

`/mcp` returns 401 with no token or an invalid token, and serves `tools/list` /
`tools/call whoami` with a valid one.
