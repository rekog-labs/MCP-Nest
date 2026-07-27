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
- Dynamic Client Registration (RFC 7591): `POST /auth/register` (deprecated in
  MCP revision `2026-07-28`, still fully supported here)
- PKCE required and advertised (`code_challenge_methods_supported: ["S256"]`)
- JWT validation of locally-signed tokens by the `/mcp` middleware
- Guarded MCP calls with a locally-minted JWT

Mint a local token (signed with the same `jwtSecret`, so `validateToken` accepts
it without any IdP call):

```bash
TOKEN=$(npx ts-node scripts/mint-jwt.ts)
bunx @modelcontextprotocol/inspector --cli http://localhost:3014/mcp \
  --transport http --header "Authorization: Bearer $TOKEN" --method tools/list
```

With `MCP_FAKE_AUTH=1` alone the `authorize → callback` interactive leg still
needs the external IdP and is **not** runnable. Add `MCP_FAKE_IDP=1` (below) to
get an offline stand-in for it.

## What was verified (FAKE mode)

- Discovery JSON shape matches the doc.
- `POST /auth/register` returns a registered client (`client_id`).
- PKCE methods advertised.
- `/mcp` accepts a valid locally-minted JWT (`whoami` → `Hello, Ada Lovelace!`),
  rejects missing / malformed / wrong-secret tokens with `401`.
- `disableEndpoints` disables a discovery route (→ `404`) while keeping the other.
- `@McpUser()` projects `req.user`.

---

## Tier 4 walkthrough: consent screen and Client ID Metadata Documents

Three **opt-in** environment flags, all default off. With none of them set this
example behaves exactly as it did before they existed — same routes, same
metadata document, same GitHub provider, same log output.

| Flag | Effect |
|---|---|
| `MCP_CONSENT=1` | Turns on the interactive consent screen (`consent: { enabled: true }`). |
| `MCP_CIMD=1` | Accepts URL-shaped `client_id`s, and hosts `GET /client-metadata.json` + `GET /demo-callback` so the *client* side of the demo runs locally too. Implies consent — `McpAuthModule` forces it on. |
| `MCP_FAKE_IDP=1` | ⚠️ Replaces GitHub with a local stub that authenticates **everyone** as "Ada Lovelace", with no network call. Implies `MCP_FAKE_AUTH=1`. |

### FAKE-mode shortcuts, stated plainly

Everything below except `MCP_FAKE_IDP=1` is real production behaviour. Two things
are shortcuts and neither is safe outside a demo:

1. **`MCP_FAKE_IDP=1`** — there is no authentication. A real deployment sends the
   user to GitHub/Google/Keycloak here. It exists only so the browser leg (and
   therefore the consent screen) can be walked through offline.
2. **`allowInsecureClientIdScheme: true`**, which `MCP_CIMD=1` sets — this
   accepts `http://` `client_id` URLs *and* disables the SSRF guard, which is the
   only reason `http://localhost:3014/client-metadata.json` works as a
   `client_id`. With it on, an unauthenticated caller can make this server fetch
   e.g. `https://169.254.169.254/...` (the cloud instance-metadata endpoint). In
   production the document must live on a public `https` origin and this option
   must stay `false`.

### A. Consent screen only

```bash
PORT=3014 MCP_FAKE_IDP=1 MCP_CONSENT=1 npm start
```

Register a client and start an authorization request in a browser:

```bash
CLIENT_ID=$(curl -s -X POST http://localhost:3014/auth/register \
  -H 'content-type: application/json' \
  -d '{"client_name":"DCR Consent Demo","redirect_uris":["http://127.0.0.1:33418/callback"]}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["client_id"])')

echo "http://localhost:3014/auth/authorize?response_type=code&client_id=$CLIENT_ID&redirect_uri=http%3A%2F%2F127.0.0.1%3A33418%2Fcallback&code_challenge=WMlOi-4SP-ouuMs3uOb7jhkkMKK5SSJ9Z8Eagvs1wmk&code_challenge_method=S256&state=demo-state"
```

Open that URL. The fake IdP bounces straight back to `/auth/callback`, which now
answers with the **consent screen** instead of redirecting. It shows:

- the client name, and who you are signed in as ("Ada Lovelace"),
- **`127.0.0.1` — the redirect URI hostname**, as its own prominent field
  (`draft/basic/authorization/security-considerations` makes displaying this a
  MUST for a CIMD-capable server),
- an **orange loopback warning**, because the code will be delivered to a port on
  this machine that any local process could have bound (a SHOULD),
- the scopes that will actually be granted — already narrowed, so you see what
  you are approving rather than what was requested.

Click **Approve** and the browser lands on
`http://127.0.0.1:33418/callback?code=…&state=demo-state&iss=http://localhost:3014`.
Nothing is listening on 33418, so the browser shows a connection error — the
`code` in the address bar is the point. Click **Deny** instead and you get
`?error=access_denied&…` on the same URI (RFC 6749 §4.1.2.1).

The `code_challenge` above is the S256 hash of the verifier
`sSQKjtmhf3TsxI14yDaGqZpyHg7l1hzoYGMHvRtknJQ`, so you can redeem the code:

```bash
curl -s -X POST http://localhost:3014/auth/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=authorization_code \
  --data-urlencode "code=<the code from the address bar>" \
  --data-urlencode code_verifier=sSQKjtmhf3TsxI14yDaGqZpyHg7l1hzoYGMHvRtknJQ \
  --data-urlencode redirect_uri=http://127.0.0.1:33418/callback \
  --data-urlencode "client_id=$CLIENT_ID"
```

Approving is remembered for the same (user, client, scope) triple, so a second
authorization request goes straight through with no screen. Start the server with
`MCP_CONSENT=1` and `consent.rememberForMs: 0` in `main.ts` to prompt every time.

### B. Client ID Metadata Documents

```bash
PORT=3014 MCP_FAKE_IDP=1 MCP_CIMD=1 npm start
```

The server now advertises support, and hosts a document *as if it were the
client*:

```bash
curl -s http://localhost:3014/.well-known/oauth-authorization-server \
  | grep -o '"client_id_metadata_document_supported":true'

curl -s http://localhost:3014/client-metadata.json
```

```jsonc
{
  "client_id": "http://localhost:3014/client-metadata.json",   // MUST match this URL exactly
  "client_name": "CIMD Demo Client",
  "client_uri": "http://localhost:3014",
  "redirect_uris": [
    "http://localhost:3014/demo-callback",                     // a viewable stand-in
    "http://127.0.0.1:33418/callback"                          // what a real MCP client uses
  ],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none"                          // CIMD clients are public
}
```

**There is no registration step.** The URL *is* the `client_id`. Open:

```
http://localhost:3014/auth/authorize?response_type=code&client_id=http%3A%2F%2Flocalhost%3A3014%2Fclient-metadata.json&redirect_uri=http%3A%2F%2Flocalhost%3A3014%2Fdemo-callback&code_challenge=WMlOi-4SP-ouuMs3uOb7jhkkMKK5SSJ9Z8Eagvs1wmk&code_challenge_method=S256&state=demo-state&scope=offline_access
```

The server fetches the document, validates it, and shows the consent screen —
with one extra sentence in the loopback warning, because a name that came from a
document *anyone may reference* deserves less trust than a registered one:

```
Authorization code will be sent to
  localhost
  http://localhost:3014/demo-callback

This client receives the authorization code on this computer.
localhost is a loopback address, so any program running locally could have
opened that port and be impersonating CIMD Demo Client, whose name and logo
come from a document that anyone may reference. Approve only if you just
started this application yourself.

Client identifier  http://localhost:3014/client-metadata.json
Client website     http://localhost:3014
Requested access   offline_access
```

Click **Approve** and this time the browser lands on a page that *shows* you the
`code`, `state` and `iss`, because `/demo-callback` is served by this example.
Redeem it with the same URL as `client_id` (and no secret — it is a public
client):

```bash
curl -s -X POST http://localhost:3014/auth/token \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode grant_type=authorization_code \
  --data-urlencode "code=<the code>" \
  --data-urlencode code_verifier=sSQKjtmhf3TsxI14yDaGqZpyHg7l1hzoYGMHvRtknJQ \
  --data-urlencode redirect_uri=http://localhost:3014/demo-callback \
  --data-urlencode client_id=http://localhost:3014/client-metadata.json
```

```json
{ "access_token": "eyJhbGciOiJIUzI1NiIs…", "token_type": "bearer", "expires_in": 86400, "refresh_token": "…" }
```

That token works against `/mcp` like any other:

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3014/mcp \
  --transport http --header "Authorization: Bearer <access_token>" --method tools/list
```

Redemption used the document **snapshot** taken at `/authorize`, not a second
fetch — so the grant is pinned to exactly the metadata the user saw.

### C. Rejections worth seeing

Every one of these is an HTTP 400 with a message naming the reason ("if the
authorization server fails to retrieve the client metadata document, it SHOULD
abort the authorization request"). Run with `MCP_CIMD=1` and vary `client_id`:

```bash
Q='response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3014%2Fdemo-callback&code_challenge=WMlOi-4SP-ouuMs3uOb7jhkkMKK5SSJ9Z8Eagvs1wmk&code_challenge_method=S256&state=s'

# nothing hosted there
curl -s "http://localhost:3014/auth/authorize?$Q&client_id=http%3A%2F%2Flocalhost%3A3014%2Fnope.json"
# → client metadata document request returned HTTP 404

# no path component
curl -s "http://localhost:3014/auth/authorize?$Q&client_id=http%3A%2F%2Flocalhost%3A3014"
# → client_id must contain a path component, e.g. https://example.com/client.json

# dot segments
curl -s "http://localhost:3014/auth/authorize?$Q&client_id=http%3A%2F%2Flocalhost%3A3014%2Fa%2F..%2Fclient-metadata.json"
# → client_id must not contain single-dot or double-dot path segments

# a URI the document does not declare
curl -s "http://localhost:3014/auth/authorize?response_type=code&client_id=http%3A%2F%2Flocalhost%3A3014%2Fclient-metadata.json&redirect_uri=http%3A%2F%2Fevil.example%2Fcb&code_challenge=x&code_challenge_method=S256"
# → Invalid redirect_uri
```

The **SSRF refusals** (private/loopback addresses, non-`https` schemes) are not
visible in this demo, because `allowInsecureClientIdScheme: true` is exactly the
switch that disables them. Drop `MCP_CIMD=1`'s hatch (edit `main.ts`) and
`http://…` and `https://127.0.0.1/…` are both refused before any connection is
attempted. `tests/mcp-oauth-cimd.e2e.spec.ts` covers that posture.

### D. Everything at once

```bash
PORT=3014 MCP_FAKE_IDP=1 MCP_CONSENT=1 MCP_CIMD=1 npm start
```

> **Running against the workspace build?** When this example is installed with a
> `file:` dependency (`scripts/use-examples.sh local`) the symlinked packages
> resolve a second `@nestjs/core` from the workspace root, which Nest's injector
> rejects. Add `NODE_OPTIONS=--preserve-symlinks` — this is a linking artifact,
> not a product issue, and is what `e2e/harness.ts` does. A normal `npm install`
> of the published packages needs nothing.
