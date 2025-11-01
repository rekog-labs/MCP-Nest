# Per-Tool Authorization

This guide explains how to implement fine-grained, per-tool authorization in your MCP server using the `@Public()`, `@RequireScopes()`, and `@RequireRoles()` decorators.

## Overview

Per-tool authorization allows you to control access to individual tools based on:
- **Authentication status** - Is the user authenticated?
- **OAuth scopes** - Does the user have specific permissions?
- **Roles** - Does the user have specific roles?

When module-level guards are configured, all tools require authentication by default. You can then use decorators to:
- Mark specific tools as public with `@Public()`
- Require additional scopes with `@RequireScopes(['scope1', 'scope2'])`
- Require specific roles with `@RequireRoles(['role1', 'role2'])`

## Security Schemes

The implementation follows the [OpenAI securitySchemes specification](https://developers.openai.com/apps-sdk/build/auth#pertool-authentication-with-securityschemes) and includes `securitySchemes` in tool responses:

```json
{
  "name": "admin-delete",
  "description": "Delete a user (admin only)",
  "securitySchemes": [
    { "type": "oauth2", "scopes": ["admin", "write"] }
  ]
}
```

## Basic Usage

### 1. Configure Module with Guards

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
      guards: [McpAuthJwtGuard], // Enable authentication
    }),
  ],
  providers: [MyTools, McpAuthJwtGuard],
})
export class AppModule {}
```

### 2. Define Tools with Authorization

```typescript
import { Injectable } from '@nestjs/common';
import { Tool, Public, RequireScopes, RequireRoles } from '@rekog/mcp-nest';
import { z } from 'zod';

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
  @Public()
  async publicSearch({ query }) {
    return {
      content: [
        {
          type: 'text',
          text: `Public search results for: ${query}`,
        },
      ],
    };
  }

  // Protected tool - requires authentication (module has guards)
  @Tool({
    name: 'user-profile',
    description: 'Get user profile',
  })
  async getUserProfile(args, context, request: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Profile for ${request.user.name}`,
        },
      ],
    };
  }

  // Requires specific OAuth scopes
  @Tool({
    name: 'admin-delete',
    description: 'Delete user (admin only)',
    parameters: z.object({
      userId: z.string(),
    }),
  })
  @RequireScopes(['admin', 'write'])
  async deleteUser({ userId }) {
    return {
      content: [
        {
          type: 'text',
          text: `User ${userId} deleted`,
        },
      ],
    };
  }

  // Requires specific roles
  @Tool({
    name: 'system-config',
    description: 'Configure system settings',
  })
  @RequireRoles(['admin'])
  async configureSystem() {
    return {
      content: [
        {
          type: 'text',
          text: 'System configured',
        },
      ],
    };
  }

  // Optional authentication - enhanced with premium scope
  @Tool({
    name: 'smart-search',
    description: 'Smart search with optional premium features',
    parameters: z.object({
      query: z.string(),
    }),
  })
  @Public()
  @RequireScopes(['premium'])
  async smartSearch({ query }, context, request: any) {
    if (request.user?.scopes?.includes('premium')) {
      return {
        content: [
          {
            type: 'text',
            text: `AI-powered premium results for: ${query}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `Basic results for: ${query}`,
        },
      ],
    };
  }
}
```

## How It Works

### Tool Listing

When a client requests the tool list:

1. **Without authentication**: Only public tools are returned
2. **With basic authentication**: Public tools + authenticated user tools
3. **With scopes**: Public tools + authenticated tools + tools matching user's scopes
4. **With roles**: Public tools + authenticated tools + tools matching user's roles

Example:

```bash
# No authentication - only sees public tools
curl http://localhost:3030/mcp \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Response: only "public-search" and "smart-search"

# With authentication - sees all allowed tools
curl http://localhost:3030/mcp \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Response: tools based on user's scopes/roles
```

### Tool Execution

When a client calls a tool:

1. **Public tools**: Allowed without authentication
2. **Protected tools**: Require valid JWT token
3. **Scope-protected tools**: Require token + matching scopes
4. **Role-protected tools**: Require token + matching roles

Example:

```bash
# Calling a public tool (works without auth)
curl http://localhost:3030/mcp \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0",
    "id":2,
    "method":"tools/call",
    "params":{"name":"public-search","arguments":{"query":"test"}}
  }'

# Calling a protected tool (requires auth)
curl http://localhost:3030/mcp \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "jsonrpc":"2.0",
    "id":3,
    "method":"tools/call",
    "params":{"name":"user-profile","arguments":{}}
  }'
```

## Scope Management

### Including Scopes in JWT Tokens

Scopes are stored in the JWT `scope` field as a space-delimited string (OAuth 2.0 standard):

```typescript
const token = jwt.sign(
  {
    sub: userId,
    azp: clientId,
    scope: 'read write admin', // Space-delimited scopes
    iss: 'http://localhost:3030',
    aud: resource,
    type: 'access',
  },
  jwtSecret,
  { algorithm: 'HS256', expiresIn: '1h' }
);
```

The `McpAuthJwtGuard` automatically parses scopes:

```typescript
// In the enriched user object:
request.user.scope = 'read write admin';  // Original
request.user.scopes = ['read', 'write', 'admin'];  // Parsed array
```

### Defining Scopes During OAuth Flow

Scopes can be requested during the OAuth flow and stored with the access token. The `McpAuthModule` handles this automatically.

## Role Management

Roles can be stored in:
- JWT token `roles` field
- User profile `user_data.roles` field

```typescript
// In JWT payload
{
  sub: 'user123',
  roles: ['admin', 'user'],
  // ... other fields
}

// Or in user profile
{
  sub: 'user123',
  user_data: {
    roles: ['admin', 'user'],
    // ... other profile data
  }
}
```

The guard enriches the request with roles from either source.

## Error Handling

When authorization fails, the server returns clear error messages:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Tool 'admin-delete' requires scopes: admin, write"
  }
}
```

## STDIO Transport

For STDIO transport (local development), authentication is bypassed entirely:
- All tools are accessible
- No guards are enforced
- Perfect for local testing

## Best Practices

1. **Default to protected**: When using guards, tools require auth by default
2. **Explicit public**: Use `@Public()` to clearly mark public tools
3. **Principle of least privilege**: Use scopes/roles for fine-grained control
4. **Clear descriptions**: Document security requirements in tool descriptions
5. **Test all scenarios**: Test with/without auth, different scopes, etc.

## Complete Example

See the [E2E test](../tests/mcp-per-tool-auth.e2e.spec.ts) for a complete working example with:
- Public tools
- Protected tools
- Scope-based authorization
- Role-based authorization
- Optional authentication patterns
