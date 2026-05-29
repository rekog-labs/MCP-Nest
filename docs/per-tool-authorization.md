# Per-Tool Authorization

This guide explains how to implement fine-grained, per-tool authorization in your MCP server using `@PublicTool()`, `@ToolScopes()`, and `@ToolRoles()`.

For quick reference, and examples with different users, see the [Per-Tool Authorization Examples](per-tool-authorization-examples.md).

## Overview

Per-tool authorization lets you control access to individual tools based on:

* **Authentication** — is the user logged in?
* **Scopes** — does their token include required permissions?
* **Roles** — do they hold specific roles?

### Decorators

* `@PublicTool()` — accessible without authentication
* `@ToolScopes(['scope1', 'scope2'])` — requires specific OAuth scopes
* `@ToolRoles(['role1', 'role2'])` — requires specific user roles

## Security Schemes

Implements the [OpenAI `securitySchemes` spec](https://developers.openai.com/apps-sdk/build/auth#pertool-authentication-with-securityschemes).
Example tool definition:

```json
{
  "name": "admin-delete",
  "description": "Delete a user (admin only)",
  "securitySchemes": [{ "type": "oauth2", "scopes": ["admin", "write"] }]
}
```

## How authorization works

Because MCP HTTP routes are mounted on the Nest HTTP adapter (not as Nest
controllers), authentication is applied with **Express middleware** rather than a
module guard. The middleware validates the incoming token and, on success, sets
`req.user`. Per-tool authorization is then enforced by the built-in
`ToolAuthorizationService`, which reads `req.user` and evaluates the
`@PublicTool()`, `@ToolScopes()`, and `@ToolRoles()` decorators on each tool.

- The OAuth `McpAuthModule` still provides the OAuth 2.1 controllers
  (`/register`, `/authorize`, `/token`, `.well-known/*`) — it is unchanged.
- The `allowUnauthenticatedAccess` flag and the per-tool decorators are passed to
  the `McpStrategy` constructor (along with a `guards` array that signals the
  module "has guards"). See the [E2E test](../tests/mcp-per-tool-auth.e2e.spec.ts).

## Basic Setup

### 1. Configure Authentication

**Standard OAuth Flow (default)**

All MCP requests require authentication. Construct the strategy, gate the MCP
routes with middleware that validates the Bearer token and sets `req.user`, and
keep the OAuth controller endpoints open so the handshake can run:

```typescript
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  McpStrategy,
  StreamableHttpTransport,
  SseTransport,
} from '@rekog/mcp-nest';
import {
  McpAuthModule,
  GitHubOAuthProvider,
  JwtTokenService,
} from '@rekog/mcp-nest';
import { MyTools } from './my-tools';

// A non-empty `guards` array marks the module as "having guards", which the
// freemium (allowUnauthenticatedAccess) logic depends on.
class AuthGate { canActivate() { return true; } }

const mcp = new McpStrategy({
  name: 'my-mcp-server',
  version: '1.0.0',
  transports: [
    new StreamableHttpTransport({ statelessMode: false }),
    new SseTransport(),
  ],
  guards: [AuthGate],
  // allowUnauthenticatedAccess: true, // enable @PublicTool() access (see below)
});

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      serverUrl: 'http://localhost:3030',
      apiPrefix: 'auth',
    }),
  ],
  controllers: [MyTools],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });

  // Gate only the MCP transport routes; leave the OAuth endpoints open.
  const jwt = app.get(JwtTokenService);
  const mcpRoutes = ['/mcp', '/sse', '/messages'];
  app.use((req: any, res: any, next: () => void) => {
    const path: string = req.path ?? req.url ?? '';
    const isMcpRoute = mcpRoutes.some(
      (p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`),
    );
    if (!isMcpRoute) return next();

    const auth: string | undefined = req.headers?.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) { res.statusCode = 401; res.end('Unauthorized'); return; }

    const payload = jwt.validateToken(token);
    if (!payload) { res.statusCode = 401; res.end('Unauthorized'); return; }

    req.user = payload; // per-tool authorization reads this
    next();
  });

  await app.startAllMicroservices();
  await app.listen(3030);
}
void bootstrap();
```

> **Order matters:** register the middleware before `startAllMicroservices()` so
> it sits ahead of the MCP routes in the stack.

When the middleware rejects requests without a valid token, all traffic requires
authentication by default. This security-first approach ensures that:

* **Unauthenticated requests are rejected** - preventing anonymous access to your server
* **MCP Authorization Flow is triggered** - prompting clients to authenticate when needed
* **Protected tools remain secure** - only authenticated users can access any functionality

### ChatGPT Integration Behavior

In ChatGPT, users have two authentication options:

1. **Full Authentication** - Users authenticate to access all tools (public and protected)
2. **No Authentication** - Users skip authentication and can only access `@PublicTool()` tools

### Configuring Public Access

By default, `allowUnauthenticatedAccess` is `false`, meaning unauthenticated
requests are blocked entirely. To enable public tool access, allow tokenless
requests through your middleware (call `next()` without setting `req.user`) and
set `allowUnauthenticatedAccess: true` on the strategy:

```typescript
const mcp = new McpStrategy({
  name: 'my-mcp-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ statelessMode: false })],
  guards: [AuthGate],
  allowUnauthenticatedAccess: true, // Enable public tool access
});
```

When `true`, unauthenticated users can access `@PublicTool()` tools, while protected tools still require authentication.

### 2. Define Tools

Tools live on an `@McpController()` class. Read the authenticated user via the
execution context (`@Ctx()` -> `getRawRequest().user`):

```typescript
import { McpController, Tool, PublicTool, ToolScopes, ToolRoles, McpContext } from '@rekog/mcp-nest';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class MyTools {
  // Public tool - accessible without authentication
  @Tool({
    name: 'public-search',
    description: 'Search publicly available data',
    parameters: z.object({
      query: z.string(),
    }),
  })
  @PublicTool()
  async publicSearch(@Payload() { query }: { query: string }) {
    return { content: [{ type: 'text', text: `Public search results for: ${query}` }] };
  }

  // Protected tool - requires authentication (module has guards)
  @Tool({
    name: 'user-profile',
    description: 'Get user profile',
  })
  async getUserProfile(@Payload() _args: unknown, @Ctx() ctx: McpContext) {
    const user = ctx.getRawRequest<{ user?: any }>()?.user;
    return { content: [{ type: 'text', text: `Profile for ${user.name}` }] };
  }

  // Requires specific OAuth scopes
  @Tool({
    name: 'admin-delete',
    description: 'Delete user (admin only)',
    parameters: z.object({
      userId: z.string(),
    }),
  })
  @ToolScopes(['admin', 'write'])
  async deleteUser(@Payload() { userId }: { userId: string }) {
    return { content: [{ type: 'text', text: `User ${userId} deleted` }] };
  }

  // Requires specific user roles
  @Tool({ name: 'system-config', description: 'Configure system settings' })
  @ToolRoles(['admin'])
  async configureSystem() {
    return { content: [{ type: 'text', text: 'System configured' }] };
  }
}
```

> **Standard guards** declared with `@UseGuards()` on an `@McpController` class or
> method also run — they execute inside the RPC pipeline. In a guard, read the
> context with `context.switchToRpc().getContext<McpContext>()` and
> `.getRawRequest()`.

## STDIO Mode

When using STDIO (local dev), authentication is bypassed — all tools are accessible.

---

**See the [E2E test](../tests/mcp-per-tool-auth.e2e.spec.ts)** for a full working example with public, protected, scoped, and role-based tools.
