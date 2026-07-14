# Resources

Resources are static or dynamic data sources that AI agents can read. They're like read-only files or databases that tools can reference. In mcp-nest, resources are defined using the `@Resource()` decorator.

## Basic Resource

A static resource with a fixed URI:

```typescript
import { Injectable, Scope } from '@nestjs/common';
import { Resource } from '@rekog/mcp-nest';

@Injectable({ scope: Scope.REQUEST })
export class GreetingResource {
  @Resource({
    name: 'languages-informal-greetings',
    description: 'Languages and their informal greeting phrases',
    mimeType: 'application/json',
    uri: 'mcp://languages/informal-greetings',
  })
  getLanguagesInformalGreetings({ uri }) {
    const languages = {
      en: 'Hey',
      es: 'Qué tal',
      fr: 'Salut',
      de: 'Hi',
      it: 'Ciao',
      pt: 'Oi',
      ja: 'やあ',
      ko: '안녕',
      zh: '嗨',
    };

    return {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify(languages, null, 2),
        },
      ],
    };
  }
}
```

## Key Properties

- **name**: Human-readable name for the resource
- **description**: What this resource contains
- **mimeType**: Content type (e.g., `application/json`, `text/plain`, `text/markdown`)
- **uri**: Unique identifier using `mcp://` scheme

## Method Signature

Resource methods receive:

- An object with the `uri` parameter
- Additional context if needed

They must return:

- `contents`: Array of content objects
- Each content object has: `uri`, `mimeType`, `text`

## Different Content Types

### JSON Resource

```typescript
@Resource({
  name: 'config-data',
  description: 'Application configuration',
  mimeType: 'application/json',
  uri: 'mcp://config/app',
})
getConfig({ uri }) {
  return {
    contents: [{
      uri,
      mimeType: 'application/json',
      text: JSON.stringify({ version: '1.0', debug: true }),
    }],
  };
}
```

### Plain Text Resource

```typescript
@Resource({
  name: 'help-text',
  description: 'Help documentation',
  mimeType: 'text/plain',
  uri: 'mcp://help/usage',
})
getHelp({ uri }) {
  return {
    contents: [{
      uri,
      mimeType: 'text/plain',
      text: 'This is how you use the application...',
    }],
  };
}
```

### Markdown Resource

```typescript
@Resource({
  name: 'readme',
  description: 'Project documentation',
  mimeType: 'text/markdown',
  uri: 'mcp://docs/readme',
})
getReadme({ uri }) {
  return {
    contents: [{
      uri,
      mimeType: 'text/markdown',
      text: '# My Project\n\nThis project does amazing things...',
    }],
  };
}
```

## Testing Your Resources

### 1. Start the Server

Run the playground server:

```bash
npx ts-node-dev --respawn playground/servers/server-stateful.ts
```

### 2. List Available Resources

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method resources/list
```

Expected output:

```json
{
  "resources": [
    {
      "name": "languages-informal-greetings",
      "description": "Languages and their informal greeting phrases",
      "mimeType": "application/json",
      "uri": "mcp://languages/informal-greetings"
    }
  ]
}
```

### 3. Read a Specific Resource

```bash
npx @modelcontextprotocol/inspector@0.16.2 --cli http://localhost:3030/mcp --transport http --method resources/read --uri "mcp://languages/informal-greetings"
```

Expected output:

```json
{
  "contents": [
    {
      "uri": "mcp://languages/informal-greetings",
      "mimeType": "application/json",
      "text": "{\n  \"en\": \"Hey\",\n  \"es\": \"Qué tal\",\n  \"fr\": \"Salut\",\n  \"de\": \"Hi\",\n  \"it\": \"Ciao\",\n  \"pt\": \"Oi\",\n  \"ja\": \"やあ\",\n  \"ko\": \"안녕\",\n  \"zh\": \"嗨\"\n}"
    }
  ]
}
```

### 4. Interactive Testing

For interactive testing, use the MCP Inspector UI:

```bash
npx @modelcontextprotocol/inspector@0.16.2
```

Connect to `http://localhost:3030/mcp` and browse the resources to see your data.

## Example Location

See the complete example at: `playground/resources/greeting.resource.ts`

## Related

- For dynamic resources with parameters, see [Resource Templates](resource-templates.md)
- For executable functions, see [Tools](tools.md)
