# Per-Tool Authorization Examples

Start the server with unauthenticated access enabled:

```bash
export ALLOW_UNAUTHENTICATED_ACCESS=true

npx ts-node-dev playground/servers/server-simple-jwt.ts
```

The server uses the tools defined in [greeting.tool.ts](../playground/resources/greeting.tool.ts), showcasing the different authorization decorators, and has a simple JWT auth setup to simplify testing. In reality you would use a full OAuth provider like GitHub, Google, as shown in the [server-oauth.ts](../playground/servers/server-oauth.ts) example.

Next, configure your shell with the user JWTs:

```bash
source playground/clients/utils/user-jwts.sh
```

Next, you can try accessing different tools by swapping the JWTs: `BASIC_USER`, `ADMIN_USER`, `PREMIUM_USER`, `SUPERADMIN_USER`.

## Tool Access Examples

### Non-Authenticated User

Can access: public-greet-world

Test with:

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3030/mcp --transport http \
  --method tools/list

bunx @modelcontextprotocol/inspector --cli http://localhost:3030/mcp --transport http \
  --method tools/call --tool-name public-greet-world
```

### BASIC USER

Expected Access:
- ✅ public-greet-world (Public)
- ✅ greet-logged-in-user (Authenticated)
- ✅ greet-world (No auth required)
- ✅ greet-user (No auth required)
- ❌ admin-greet (Missing admin scopes)
- ❌ premium-greet (Missing premium role)
- ❌ super-admin-greet (Missing scopes + role)

Test with:

```bash
bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3030/mcp \
  --transport http --method tools/list \
  --header "Authorization: Bearer $BASIC_USER"

bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3030/mcp \
  --transport http --method tools/call \
  --tool-name greet-logged-in-user \
  --header "Authorization: Bearer $BASIC_USER"
```

### ADMIN USER
Scopes: admin write read

Expected Access:

- ✅ public-greet-world (Public)
- ✅ greet-logged-in-user (Authenticated)
- ✅ greet-world (No auth required)
- ✅ greet-user (No auth required)
- ✅ admin-greet (Has admin + write scopes)
- ❌ premium-greet (Missing premium role)
- ❌ super-admin-greet (Missing super-admin role)

Test with:

```bash
bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3030/mcp \
  --transport http --method tools/list --header "Authorization: Bearer $ADMIN_USER"

bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3030/mcp \
  --transport http --method tools/call \
  --tool-name admin-greet \
  --tool-arg message="message from admin" \
  --header "Authorization: Bearer $ADMIN_USER"
```

### PREMIUM USER

Scopes: read write

Roles: premium

Expected Access:

- ✅ public-greet-world (Public)
- ✅ greet-logged-in-user (Authenticated)
- ✅ greet-world (No auth required)
- ✅ greet-user (No auth required)
- ❌ admin-greet (Missing admin scopes)
- ✅ premium-greet (Has premium role)
- ❌ super-admin-greet (Missing admin scopes + super-admin role)

```bash
bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3030/mcp \
  --transport http --method tools/list \
  --header "Authorization: Bearer $PREMIUM_USER"

bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3030/mcp \
  --transport http --method tools/call \
  --tool-name premium-greet \
  --tool-arg name="PremiumX" \
  --tool-arg level="gold" \
  --header "Authorization: Bearer $PREMIUM_USER"
```

### SUPERADMIN USER

Scopes: admin write delete read

Roles: super-admin, admin

Expected Access:

- ✅ public-greet-world (Public)
- ✅ greet-logged-in-user (Authenticated)
- ✅ greet-world (No auth required)
- ✅ greet-user (No auth required)
- ✅ admin-greet (Has admin + write scopes)
- ✅ premium-greet (Has premium role)
- ✅ super-admin-greet (Has all admin scopes + super-admin role)

Test with:

```bash
bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3030/mcp \
  --transport http --method tools/list --header "Authorization: Bearer $SUPERADMIN_USER"

bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3030/mcp \
  --transport http --method tools/call \
  --tool-name super-admin-greet \
  --tool-arg target="BasicUser" \
  --tool-arg action="approve" \
  --header "Authorization: Bearer $SUPERADMIN_USER"
```