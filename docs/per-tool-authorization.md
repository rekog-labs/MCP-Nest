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

## Basic Setup

### 1. Configure Authentication

**Standard OAuth Flow (default)**
All requests require authentication:

```typescript
@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      serverUrl: 'http://localhost:3030',
    }),
    McpModule.forRoot({
      name: 'my-mcp-server',
      version: '1.0.0',
      guards: [McpAuthJwtGuard],
      // allowUnauthenticatedAccess: true,
    }),
  ],
  providers: [MyTools, McpAuthJwtGuard],
})
export class AppModule {}
```

When guarding access to the MCP Server with `McpAuthJwtGuard`, all traffic requires authentication by default. This security-first approach ensures that:

* **Unauthenticated requests are rejected** - preventing anonymous access to your server
* **MCP Authorization Flow is triggered** - prompting clients to authenticate when needed
* **Protected tools remain secure** - only authenticated users can access any functionality

### ChatGPT Integration Behavior

In ChatGPT, users have two authentication options:

1. **Full Authentication** - Users authenticate to access all tools (public and protected)
2. **No Authentication** - Users skip authentication and can only access `@PublicTool()` tools

### Configuring Public Access

By default, `allowUnauthenticatedAccess` is `false`, meaning unauthenticated requests are blocked entirely. To enable public tool access:

```typescript
McpModule.forRoot({
  name: 'my-mcp-server',
  version: '1.0.0',
  guards: [McpAuthJwtGuard],
  allowUnauthenticatedAccess: true, // Enable public tool access
})
```

When `true`, unauthenticated users can access `@PublicTool()` tools, while protected tools still require authentication.

### 2. Define Tools

```typescript
@Injectable()
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
  async publicSearch({ query }) {
    return `Public search results for: ${query}`;
  }

  // Protected tool - requires authentication (module has guards)
  @Tool({
    name: 'user-profile',
    description: 'Get user profile',
  })
  async getUserProfile(args, context, request: any) {
    return `Profile for ${request.user.name}`;
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
  async deleteUser({ userId }) {
    return `User ${userId} deleted`;
  }

  // Requires specific user roles
  @Tool({ name: 'system-config', description: 'Configure system settings' })
  @ToolRoles(['admin'])
  async configureSystem() {
    return `System configured`;
  }
}
```

## STDIO Mode

When using STDIO (local dev), authentication is bypassed — all tools are accessible.

---

**See the [E2E test](../tests/mcp-per-tool-auth.e2e.spec.ts)** for a full working example with public, protected, scoped, and role-based tools.
