# URL Elicitation

URL elicitation allows MCP servers to request sensitive user input through URL-based flows. This is useful for scenarios like:

- Collecting API keys from third-party services
- Payment confirmation flows
- OAuth authorization with external providers
- User consent dialogs

## Overview

The `McpElicitationModule` provides a complete implementation of URL mode elicitation following the MCP specification. It includes:

- **Pluggable store interface** for elicitation state management
- **Built-in HTML templates** for common elicitation patterns
- **Context helpers** for convenient URL elicitation in tools
- **HTTP endpoints** for completing elicitation flows
- **Completion notifications** to signal clients when elicitation is done

## Quick Start

### 1. Install and Configure

```typescript
import { Module } from '@nestjs/common';
import { McpModule, McpElicitationModule } from '@rekog/mcp-nest';

@Module({
  imports: [
    McpElicitationModule.forRoot({
      serverUrl: 'http://localhost:3000',
      apiPrefix: 'elicit',
    }),
    McpModule.forRoot({
      name: 'my-mcp-server',
      version: '1.0.0',
    }),
  ],
})
export class AppModule {}
```

### 2. Create a Tool That Uses Elicitation

```typescript
import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';

@Injectable()
export class ApiKeyTool {
  @Tool({
    name: 'connect-service',
    description: 'Connect to an external service',
    parameters: z.object({
      service: z.string(),
    }),
  })
  async connectService({ service }, context: Context) {
    // Check if elicitation is available
    if (!context.elicitation) {
      return {
        content: [{ type: 'text', text: 'Elicitation not configured' }],
      };
    }

    // Check if we already have an API key for this user and service
    const userId = context.mcpRequest.params?._meta?.userId;
    const existingResult = await context.elicitation.findByUserAndType(
      userId,
      `api-key-${service}`,
    );

    if (existingResult?.success && existingResult.data?.apiKey) {
      // Use the stored API key
      const apiKey = existingResult.data.apiKey as string;
      return {
        content: [{ type: 'text', text: `Connected to ${service}` }],
      };
    }

    // Check if client supports URL elicitation
    if (!context.elicitation.isSupported()) {
      return {
        content: [{ type: 'text', text: 'URL elicitation not supported by client' }],
      };
    }

    // Create URL elicitation for API key
    const { elicitationId, url } = await context.elicitation.createUrl({
      message: `Please enter your ${service} API key`,
      path: 'api-key',
      metadata: {
        type: `api-key-${service}`,
        service,
        fieldLabel: `${service} API Key`,
      },
    });

    // Throw to signal client that URL elicitation is required
    context.elicitation.throwRequired([
      {
        mode: 'url',
        message: `Please enter your ${service} API key`,
        url,
        elicitationId,
      },
    ]);
  }
}
```

## Configuration Options

```typescript
McpElicitationModule.forRoot({
  // Required: Base URL of your server
  serverUrl: 'http://localhost:3000',

  // Optional: URL prefix for elicitation endpoints (default: 'elicit')
  apiPrefix: 'elicit',

  // Optional: Time-to-live for elicitations in milliseconds (default: 600000 = 10 min)
  elicitationTtlMs: 600000,

  // Optional: Cleanup interval in milliseconds (default: 60000 = 1 min)
  cleanupIntervalMs: 60000,

  // Optional: Store configuration
  storeConfiguration: {
    type: 'memory', // or 'custom'
    // For custom stores:
    // store: myCustomStore,
  },

  // Optional: Custom endpoint paths
  endpoints: {
    status: 'status',     // GET /:id/status
    apiKey: 'api-key',    // GET/POST /:id/api-key
    confirm: 'confirm',   // GET/POST /:id/confirm
  },

  // Optional: Template customization
  templateOptions: {
    primaryColor: '#007bff',
    title: 'My App',
  },
});
```

## Built-in Endpoints

The module provides several built-in endpoints:

### Status Endpoint

```
GET /elicit/:id/status
```

Returns the current status of an elicitation:

```json
{
  "elicitationId": "abc-123",
  "status": "pending",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "expiresAt": "2024-01-01T00:10:00.000Z",
  "completed": false
}
```

### API Key Form

```
GET /elicit/:id/api-key
```

Renders an HTML form for collecting an API key. The form can be customized via metadata:

```typescript
const { url } = await context.elicitation.createUrl({
  message: 'Please enter your Stripe API key',
  path: 'api-key',
  metadata: {
    type: 'api-key-stripe',
    fieldLabel: 'Stripe API Key',
    placeholder: 'sk_live_...',
    description: 'Your API key will be stored securely.',
  },
});
```

### Confirmation Page

```
GET /elicit/:id/confirm
```

Renders an HTML confirmation page with confirm/cancel buttons:

```typescript
const { url } = await context.elicitation.createUrl({
  message: 'Are you sure you want to proceed?',
  path: 'confirm',
  metadata: {
    type: 'delete-confirmation',
    title: 'Delete Account',
    warning: 'This action cannot be undone',
    confirmLabel: 'Yes, Delete',
    cancelLabel: 'Cancel',
  },
});
```

## Context Elicitation API

When `McpElicitationModule` is configured, tools receive an `elicitation` object on the context:

### `createUrl(params)`

Create a new URL elicitation:

```typescript
const result = await context.elicitation.createUrl({
  message: 'Enter your API key',
  path: 'api-key',  // 'api-key' | 'confirm' | custom path
  metadata: {
    type: 'api-key-service',
    // Additional metadata stored with the elicitation
  },
});

// result contains:
// - elicitationId: string
// - url: string
// - completionNotifier: () => Promise<void>
```

### `throwRequired(elicitations)`

Throw an error to signal the client that URL elicitation is required:

```typescript
context.elicitation.throwRequired([
  {
    mode: 'url',
    message: 'Please enter your API key',
    url,
    elicitationId,
  },
]);
```

### `isSupported()`

Check if the client supports URL elicitation:

```typescript
if (!context.elicitation.isSupported()) {
  return { content: [{ type: 'text', text: 'URL elicitation not supported' }] };
}
```

### `getResult(elicitationId)`

Get a completed elicitation result by ID:

```typescript
const result = await context.elicitation.getResult(elicitationId);
if (result?.success) {
  const apiKey = result.data?.apiKey as string;
}
```

### `findByUserAndType(userId, type)`

Find a completed elicitation by user and type (stored in metadata):

```typescript
const result = await context.elicitation.findByUserAndType(userId, 'api-key-stripe');
if (result?.success && result.data?.apiKey) {
  // Use the stored API key
}
```

### `elicitForm(params)`

Use form-mode elicitation (inline in the client):

```typescript
const response = await context.elicitation.elicitForm({
  message: 'Please provide your name',
  requestedSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Your name' },
    },
  },
});
```

## Elicitation Flow

The typical URL elicitation flow works as follows:

```
1. Tool Call (First Request)
   - Tool checks for existing elicitation result
   - No result found, creates URL elicitation
   - Throws UrlElicitationRequiredError

2. Client Receives Error
   - Client displays URL to user
   - User opens URL in browser

3. User Completes Elicitation
   - User fills form/confirms action
   - Server stores result
   - Server sends completion notification to client

4. Tool Call (Retry)
   - Client retries the same tool call
   - Tool checks for existing elicitation result
   - Result found, tool proceeds with the data
```

## Connecting Requests

The connection between the first request and the retry is made through the **user + type** lookup pattern:

1. **On first request**: Store `userId` and `type` in elicitation metadata
2. **On retry**: Look up result using `findByUserAndType(userId, type)`

The `type` is typically derived from tool arguments (e.g., `api-key-${service}`), so the same tool call with the same arguments will find the correct result.

```typescript
@Tool({ name: 'connect-service', parameters: z.object({ service: z.string() }) })
async connectService({ service }, context: Context) {
  const userId = getUserId(); // From auth or request
  const type = `api-key-${service}`;

  // Check for existing result
  const existing = await context.elicitation.findByUserAndType(userId, type);
  if (existing?.success && existing.data?.apiKey) {
    // Use stored API key
    return { content: [{ type: 'text', text: 'Connected!' }] };
  }

  // Create elicitation with type for later lookup
  const { url, elicitationId } = await context.elicitation.createUrl({
    message: `Enter ${service} API key`,
    path: 'api-key',
    metadata: { type, userId },
  });

  // Signal client
  context.elicitation.throwRequired([{ mode: 'url', message: '...', url, elicitationId }]);
}
```

## Custom Store Implementation

For production deployments with multiple server instances, implement a custom store:

```typescript
import { IElicitationStore, Elicitation, ElicitationResult } from '@rekog/mcp-nest';

@Injectable()
class RedisElicitationStore implements IElicitationStore {
  constructor(private redis: RedisService) {}

  async storeElicitation(elicitation: Elicitation): Promise<void> {
    await this.redis.set(
      `elicitation:${elicitation.elicitationId}`,
      JSON.stringify(elicitation),
      'PX',
      elicitation.expiresAt.getTime() - Date.now(),
    );
  }

  async getElicitation(elicitationId: string): Promise<Elicitation | undefined> {
    const data = await this.redis.get(`elicitation:${elicitationId}`);
    return data ? JSON.parse(data) : undefined;
  }

  // Implement other methods...
}

// Configure with custom store
McpElicitationModule.forRoot({
  serverUrl: 'http://localhost:3000',
  storeConfiguration: {
    type: 'custom',
    store: new RedisElicitationStore(redisService),
  },
});
```

## Template Customization

The built-in templates can be customized via `templateOptions`:

```typescript
McpElicitationModule.forRoot({
  serverUrl: 'http://localhost:3000',
  templateOptions: {
    primaryColor: '#6366f1',  // Indigo color
    title: 'My Application',
  },
});
```

For full template customization, implement custom endpoints using NestJS controllers.

## Error Handling

### UrlElicitationRequiredError

When a tool throws `UrlElicitationRequiredError` (via `throwRequired`), the MCP protocol returns error code `-32042` to the client with the elicitation URLs.

### Expired Elicitations

Elicitations expire after `elicitationTtlMs` (default: 10 minutes). The memory store automatically removes expired entries during periodic cleanup and on access.

### Completion Notifications

When an elicitation is completed, the server sends a `notifications/elicitation/complete` notification to the client. This signals that the client can retry the tool call.

## Integration with McpAuthModule

For authenticated scenarios, combine with `McpAuthModule`:

```typescript
@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      // ...auth config
    }),
    McpElicitationModule.forRoot({
      serverUrl: 'http://localhost:3000',
    }),
    McpModule.forRoot({
      name: 'my-server',
      version: '1.0.0',
      guards: [McpAuthJwtGuard],
    }),
  ],
})
export class AppModule {}
```

The authenticated user's ID is available in the tool via `request.user?.sub` and can be used for elicitation user binding.

## Best Practices

1. **Always check for existing results first** - Avoid creating duplicate elicitations
2. **Use descriptive type values** - Makes lookup reliable (e.g., `api-key-stripe`, `oauth-github`)
3. **Store userId in metadata** - Enables `findByUserAndType` lookups
4. **Handle unsupported clients** - Check `isSupported()` before creating URL elicitations
5. **Set appropriate TTLs** - Balance security (shorter) vs. user experience (longer)
6. **Use custom stores in production** - Memory store doesn't persist across restarts
