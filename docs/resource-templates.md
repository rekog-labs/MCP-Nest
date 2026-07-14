# Resource Templates

Resource Templates are dynamic resources that can accept parameters in their URIs. Unlike static resources, they use URI patterns to match different paths and extract parameters. In mcp-nest, they're defined using the `@ResourceTemplate()` decorator.

## Basic Resource Template

```typescript
import { Injectable, Scope } from '@nestjs/common';
import { ResourceTemplate } from '@rekog/mcp-nest';

@Injectable({ scope: Scope.REQUEST })
export class GreetingResource {
  @ResourceTemplate({
    name: 'user-language',
    description: "Get a specific user's preferred language",
    mimeType: 'application/json',
    uriTemplate: 'mcp://users/{name}',
  })
  getUserLanguage({ uri, name }) {
    const users = {
      alice: 'en',
      carlos: 'es',
      marie: 'fr',
      hans: 'de',
      yuki: 'ja',
      'min-jun': 'ko',
      wei: 'zh',
      sofia: 'it',
      joão: 'pt',
    };

    const language = users[name.toLowerCase()] || 'en';

    return {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify({ name, language }, null, 2),
        },
      ],
    };
  }
}
```

## URI Template Patterns

Resource templates use `path-to-regexp` style patterns:

### Single Parameter

```typescript
uriTemplate: 'mcp://users/{userId}'
// Matches: mcp://users/123
// Extracts: { userId: '123' }
```

### Multiple Parameters

```typescript
uriTemplate: 'mcp://users/{userId}/posts/{postId}'
// Matches: mcp://users/123/posts/456
// Extracts: { userId: '123', postId: '456' }
```

### Optional Parameters

```typescript
uriTemplate: 'mcp://files/{path*}'
// Matches: mcp://files/docs/readme.md
// Extracts: { path: 'docs/readme.md' }
```

## Method Signature

Resource template methods receive:

- `uri`: The actual URI that was requested
- Individual parameters extracted from the URI pattern
- Additional context if needed

## Real-World Examples

### File System Resource

```typescript
@ResourceTemplate({
  name: 'file-content',
  description: 'Read file contents from the system',
  mimeType: 'text/plain',
  uriTemplate: 'mcp://files/{path*}',
})
getFileContent({ uri, path }) {
  // Validate path for security
  if (path.includes('..') || path.startsWith('/')) {
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: 'Error: Invalid file path',
      }],
    };
  }

  // In real implementation, read actual file
  const content = `Content of file: ${path}`;

  return {
    contents: [{
      uri,
      mimeType: 'text/plain',
      text: content,
    }],
  };
}
```

### User Profile Resource

```typescript
@ResourceTemplate({
  name: 'user-profile',
  description: 'Get user profile information',
  mimeType: 'application/json',
  uriTemplate: 'mcp://profiles/{userId}',
})
async getUserProfile({ uri, userId }) {
  // In real app, query database
  const profile = await this.userService.findById(userId);

  if (!profile) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'User not found' }),
      }],
    };
  }

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(profile),
    }],
  };
}
```

### API Data Resource

```typescript
@ResourceTemplate({
  name: 'api-endpoint',
  description: 'Proxy external API data',
  mimeType: 'application/json',
  uriTemplate: 'mcp://api/{service}/{endpoint}',
})
async getApiData({ uri, service, endpoint }) {
  const allowedServices = ['github', 'weather', 'news'];

  if (!allowedServices.includes(service)) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Service not allowed' }),
      }],
    };
  }

  // Proxy to external API
  const data = await this.httpService.get(`https://api.${service}.com/${endpoint}`);

  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify(data),
    }],
  };
}
```

## Error Handling

Always handle invalid parameters gracefully:

```typescript
@ResourceTemplate({
  name: 'database-record',
  description: 'Get database records by ID',
  mimeType: 'application/json',
  uriTemplate: 'mcp://db/{table}/{id}',
})
async getRecord({ uri, table, id }) {
  try {
    // Validate table name
    const allowedTables = ['users', 'posts', 'comments'];
    if (!allowedTables.includes(table)) {
      throw new Error('Table not allowed');
    }

    // Validate ID format
    if (!/^\d+$/.test(id)) {
      throw new Error('Invalid ID format');
    }

    const record = await this.dbService.findOne(table, id);

    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(record || { error: 'Record not found' }),
      }],
    };
  } catch (error) {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({ error: error.message }),
      }],
    };
  }
}
```

## Testing Your Resource Templates

### 1. Start the Server

Run the playground server:

```bash
npx ts-node-dev --respawn playground/servers/server-stateful.ts
```

### 2. List Available Resource Templates

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method resources/templates/list
```

Expected output:

```json
{
  "resourceTemplates": [
    {
      "name": "user-language",
      "description": "Get a specific user's preferred language",
      "mimeType": "application/json",
      "uriTemplate": "mcp://users/{name}"
    }
  ]
}
```

### 3. Access Resource Templates with Different Parameters

**Test with a known user:**

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method resources/read --uri "mcp://users/carlos"
```

Expected output:

```json
{
  "contents": [
    {
      "uri": "mcp://users/alice",
      "mimeType": "application/json",
      "text": "{\n  \"name\": \"alice\",\n  \"language\": \"en\"\n}"
    }
  ]
}
```

**Test with another user:**

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method resources/read --uri "mcp://users/carlos"
```

Expected output:

```json
{
  "contents": [
    {
      "uri": "mcp://users/carlos",
      "mimeType": "application/json",
      "text": "{\n  \"name\": \"carlos\",\n  \"language\": \"es\"\n}"
    }
  ]
}
```

**Test with unknown user (fallback behavior):**

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method resources/read --uri "mcp://users/unknown"
```

Expected output:

```json
{
  "contents": [
    {
      "uri": "mcp://users/unknown",
      "mimeType": "application/json",
      "text": "{\n  \"name\": \"unknown\",\n  \"language\": \"en\"\n}"
    }
  ]
}
```

### 4. Interactive Testing

For interactive testing, use the MCP Inspector UI:

```bash
npx @modelcontextprotocol/inspector@0.16.2
```

Connect to `http://localhost:3030/mcp` and try accessing different URIs to test your templates.

## Example Location

See the complete example at: `playground/resources/greeting.resource.ts`

## Related

- For static resources, see [Resources](resources.md)
- For executable functions, see [Tools](tools.md)
