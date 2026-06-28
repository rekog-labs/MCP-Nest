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

There are two complementary layers, and it helps to keep them separate:

1. **Authentication / enforcement** — *who is this caller, and may they run this
   tool at all?* This is the server's job, done either with standard NestJS
   `@UseGuards()` on `@McpController` classes/methods (they run inside the RPC
   pipeline at *call time*) or with Express middleware on the MCP HTTP routes
   that validates the token and sets `req.user`.
2. **Per-tool visibility / filtering** — *which tools should a known principal
   see and be allowed to call?* This is what the built-in
   `ToolAuthorizationService` does: it reads `req.user` and evaluates the
   `@PublicTool()`, `@ToolScopes()`, and `@ToolRoles()` decorators on each tool,
   filtering `tools/list` and rejecting unauthorized `tools/call`.

Notes:

- There is **no module-level `guards` option** on `McpStrategy`. Use
  `@UseGuards()` (call-time enforcement) and/or auth middleware (sets `req.user`,
  which list-time filtering needs) instead.
- The OAuth `McpAuthModule` still provides the OAuth 2.1 controllers
  (`/register`, `/authorize`, `/token`, `.well-known/*`) — it is unchanged.
- `allowUnauthenticatedAccess` (freemium) and the per-tool decorators are passed
  to the `McpStrategy` constructor. See the
  [E2E test](../tests/mcp-per-tool-auth.e2e.spec.ts).

## Basic Setup

### 1. Configure Authentication

**Standard OAuth Flow (default)**

All MCP requests require authentication. Construct the strategy, gate the MCP
routes with middleware that validates the Bearer token and sets `req.user`, and
keep the OAuth controller endpoints open so the handshake can run:

The OAuth authorization server lives in a separate package. Install it alongside `@rekog/mcp-nest`:

```bash
npm install @rekog/mcp-nest-auth
```

```typescript
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import {
  McpAuthModule,
  GitHubOAuthProvider,
  JwtTokenService,
} from '@rekog/mcp-nest-auth';
import { MyTools } from './my-tools';

const mcp = new McpStrategy({
  name: 'my-mcp-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport()],
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
  const mcpRoutes = ['/mcp'];
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
  transports: [new StreamableHttpTransport()],
  allowUnauthenticatedAccess: true, // Enable public tool access
});
```

When `true`, unauthenticated users can access `@PublicTool()` tools, while protected tools still require authentication.

### 2. Define Tools

Tools live on an `@McpController()` class. Read the authenticated user from the
raw request — inject it with `@McpRawRequest()` and read `req.user`:

```typescript
import { McpController, Tool, PublicTool, ToolScopes, ToolRoles, McpRawRequest } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
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

  // Protected tool - requires an authenticated user (set by your guard/middleware)
  @Tool({
    name: 'user-profile',
    description: 'Get user profile',
  })
  async getUserProfile(
    @Payload() _args: unknown,
    @McpRawRequest() req?: { user?: any },
  ) {
    const user = req?.user;
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
