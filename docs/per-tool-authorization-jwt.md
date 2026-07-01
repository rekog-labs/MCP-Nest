# Per-Tool Authorization with JWT

The simplest way to try [per-tool authorization](per-tool-authorization.md): a
small hand-rolled JWT guard and pre-minted tokens, with **no OAuth provider to
register**. Read the [concepts guide](per-tool-authorization.md) first for how
the two authorization layers fit together; this page is the runnable walkthrough.

In production you would swap the JWT guard for a real OAuth provider — see
[Per-Tool Authorization with OAuth](per-tool-authorization-oauth.md). The
decorators on the tools (`@PublicTool()`, `@ToolScopes()`, `@ToolRoles()`) are
identical; only how `req.user` gets populated changes.

## The guard

A native NestJS guard validates the Bearer token and attaches `req.user`. Because
the MCP endpoint is mounted as a real Nest controller
(`McpHttpControllerFor(transport)`), the guard runs at the HTTP layer on *every*
transport request — including `tools/list` — which is what makes per-tool list
filtering work. See [simple-jwt.guard.ts](../examples/per-tool-authorization-jwt/src/simple-jwt.guard.ts):

```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET =
  process.env.JWT_SECRET ??
  'your_super_secret_jwt_key_at_least_32_characters_long';

// Freemium: tokenless callers are allowed through (with no `req.user`) so they
// can reach `@PublicTool()` tools; a token, if present, must still be valid.
// This value must match the strategy's `allowUnauthenticatedAccess` — the guard
// and the strategy are two halves of one decision, so the server imports it.
export const allowUnauthenticatedAccess = true;

function extractTokenFromHeader(request: Request): string | undefined {
  const [type, token] = request.headers.authorization?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
}

@Injectable()
export class SimpleJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const token = extractTokenFromHeader(req);

    if (!token) {
      // Freemium lets anonymous callers through; strict mode would reject here.
      return allowUnauthenticatedAccess;
    }

    try {
      req.user = jwt.verify(token, JWT_SECRET);
      return true;
    } catch {
      return false; // token present but invalid
    }
  }
}
```

## The wiring

Bind the guard to the MCP controller and register the tool classes. See
[main.ts](../examples/per-tool-authorization-jwt/src/main.ts):

```typescript
import { Controller, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { MyTools } from './my-tools';
import { SimpleJwtGuard, allowUnauthenticatedAccess } from './simple-jwt.guard';

// Pulled into a shared const so the guarded HTTP controller below can bind to
// the SAME transport instance via `McpHttpControllerFor(mcpTransport)`.
const mcpTransport = new StreamableHttpTransport();

const strategy = new McpStrategy({
  name: 'my-mcp-server',
  version: '1.0.0',
  transports: [mcpTransport],
  // Per-tool authorization reads `req.user` set by SimpleJwtGuard below.
  allowUnauthenticatedAccess,
});

// The MCP endpoint as a real Nest controller, so `SimpleJwtGuard` runs on every
// transport request (including `tools/list`). Referencing `mcpTransport` here
// auto-disables the transport's own self-mount, so there is no double route.
@Controller('mcp')
@UseGuards(SimpleJwtGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

@Module({
  controllers: [McpHttpController, MyTools],
  providers: [SimpleJwtGuard],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(3030);
}
void bootstrap();
```

For the tool definitions themselves (`@PublicTool()`, `@ToolScopes()`,
`@ToolRoles()`), see [Define Tools](per-tool-authorization.md#define-tools) in the
concepts guide.

### Toggling freemium

`allowUnauthenticatedAccess` is exported from the guard and imported by the
strategy, so the two always agree. Flip the single `export const` to `false` to
require a valid token for *every* request (public tools included). No per-tool
change is needed.

## Try it

Start the example server (it already wires up the guard above and the sample
tools in [my-tools.ts](../examples/per-tool-authorization-jwt/src/my-tools.ts)):

```bash
export ALLOW_UNAUTHENTICATED_ACCESS=true

cd examples/per-tool-authorization-jwt && npm install && PORT=3012 npm start
```

Load the pre-minted user JWTs into your shell:

```bash
npx ts-node scripts/mint-jwts.ts > /tmp/jwts.sh
source /tmp/jwts.sh
```

Now try the different tools by swapping the tokens: `BASIC_USER`, `ADMIN_USER`,
`PREMIUM_USER`, `SUPERADMIN_USER`.

### Non-Authenticated User

Can access: `public-greet-world`

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3012/mcp --transport http \
  --method tools/list

bunx @modelcontextprotocol/inspector --cli http://localhost:3012/mcp --transport http \
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

```bash
bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3012/mcp \
  --transport http --method tools/list \
  --header "Authorization: Bearer $BASIC_USER"

bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3012/mcp \
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

```bash
bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3012/mcp \
  --transport http --method tools/list --header "Authorization: Bearer $ADMIN_USER"

bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3012/mcp \
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
bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3012/mcp \
  --transport http --method tools/list \
  --header "Authorization: Bearer $PREMIUM_USER"

bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3012/mcp \
  --transport http --method tools/call \
  --tool-name premium-greet \
  --tool-arg name="PremiumX" \
  --tool-arg level="gold" \
  --header "Authorization: Bearer $PREMIUM_USER"
```

### SUPERADMIN USER

Scopes: admin write delete read

Roles: super-admin, admin, premium

Expected Access:

- ✅ public-greet-world (Public)
- ✅ greet-logged-in-user (Authenticated)
- ✅ greet-world (No auth required)
- ✅ greet-user (No auth required)
- ✅ admin-greet (Has admin + write scopes)
- ✅ premium-greet (Has premium role)
- ✅ super-admin-greet (Has all admin scopes + super-admin role)

```bash
bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3012/mcp \
  --transport http --method tools/list --header "Authorization: Bearer $SUPERADMIN_USER"

bunx @modelcontextprotocol/inspector@0.16.8 --cli http://localhost:3012/mcp \
  --transport http --method tools/call \
  --tool-name super-admin-greet \
  --tool-arg target="BasicUser" \
  --tool-arg action="approve" \
  --header "Authorization: Bearer $SUPERADMIN_USER"
```
