# azure-ad-oauth-provider

Greenfield verification of `docs/azure-ad-oauth-provider.md` against the published
alpha packages (`@rekog/mcp-nest@2.0.0-alpha.1`, `@rekog/mcp-nest-auth@2.0.0-alpha.1`).

The server wires `McpAuthModule` with `AzureADOAuthProvider` (built-in OAuth
authorization server) in front of a Streamable HTTP MCP endpoint. A tiny
middleware validates the Bearer JWT on `/mcp` via `JwtTokenService.validateToken`,
exactly as the doc's "Complete Server Example" shows.

## Install

```bash
npm install --no-fund --no-audit
```

## Two run modes

### REAL mode (needs a live Azure AD tenant)

Provide real credentials, then start:

```bash
export AZURE_AD_CLIENT_ID=your-azure-app-client-id
export AZURE_AD_CLIENT_SECRET=your-azure-app-client-secret
export JWT_SECRET=your-super-secure-jwt-secret-at-least-32-characters
PORT=3016 npm start
```

Then complete the browser login at
`http://localhost:3016/auth/authorize?...` to exchange an Azure code for a JWT.
The interactive authorize -> callback leg requires the live tenant and is not
verifiable offline.

### FAKE mode (offline, zero external network)

`MCP_FAKE_AUTH=1` boots with dummy Azure creds and a fixed `jwtSecret`, so every
offline-reachable feature works without any Azure round-trip:

```bash
PORT=3016 MCP_FAKE_AUTH=1 npm start
```

Mint a locally-signed JWT (signed with the same fake `jwtSecret`, so
`JwtTokenService.validateToken` accepts it) and call the guarded MCP endpoint:

```bash
TOKEN=$(PORT=3016 npm run --silent mint)

curl -s http://localhost:3016/.well-known/oauth-authorization-server | jq .
curl -s http://localhost:3016/.well-known/oauth-protected-resource | jq .

bunx @modelcontextprotocol/inspector --cli http://localhost:3016/mcp \
  --transport http --header "Authorization: Bearer $TOKEN" \
  --method tools/list | jq '.tools[].name'
```

A missing or invalid Bearer token returns `401`.

## What is / isn't verified offline

- Verified offline: module construction with `AzureADOAuthProvider`, both
  discovery endpoints, guard accepts a valid locally-minted JWT and rejects
  missing/invalid tokens, `profileMapper` mapping.
- Not verified offline (needs live tenant): the Azure `authorize -> callback`
  browser login and the real Azure token exchange.
