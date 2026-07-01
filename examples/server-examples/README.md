# try-docs / server-examples

Greenfield project verifying every runnable pattern in
[`docs/server-examples.md`](../../docs/server-examples.md) against the
published `@rekog/mcp-nest@2.0.0-alpha.1`. Each variant is a separate entry
file sharing one `GreetingTool` / `GreetingResource` / `GreetingPrompt`.

## Setup

```bash
npm install
```

## Run each variant

```bash
# Stateful (session-managed, SSE + DELETE)
PORT=3010 npx ts-node-dev --respawn src/main-stateful.ts

# Stateless (default, JSON reply, GET/DELETE -> 405)
PORT=3010 npx ts-node-dev --respawn src/main-stateless.ts

# Multiple transports (StreamableHttpTransport only, as in the doc)
PORT=3010 npx ts-node-dev --respawn src/main-multi-transport.ts

# Custom endpoint (/api/v1/mcp-operations instead of /mcp)
PORT=3010 npx ts-node-dev --respawn src/main-custom-endpoint.ts

# Global prefix coexistence (app.setGlobalPrefix('/api'), MCP stays at /mcp)
PORT=3010 npx ts-node-dev --respawn src/main-global-prefix.ts

# Logging: disabled
PORT=3010 npx ts-node-dev --respawn src/main-logging-false.ts

# Logging: filtered to error/warn
PORT=3010 npx ts-node-dev --respawn src/main-logging-filtered.ts

# Async configuration
PORT=3010 npx ts-node-dev --respawn src/main-async.ts

# STDIO (logging: false + logger: false so stdout carries only the protocol)
npx ts-node src/main-stdio.ts
```

## Test (MCP Inspector CLI)

```bash
URL=http://localhost:3010/mcp

bunx @modelcontextprotocol/inspector --cli $URL --transport http --method tools/list
bunx @modelcontextprotocol/inspector --cli $URL --transport http --method resources/list
bunx @modelcontextprotocol/inspector --cli $URL --transport http --method prompts/list
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name greet-user --tool-arg name=Alice --tool-arg language=fr

# STDIO
bunx @modelcontextprotocol/inspector --cli --transport stdio -- npx ts-node src/main-stdio.ts \
  --method tools/call --tool-name greet-user --tool-arg name=Bob --tool-arg language=es
```

Stateless GET/DELETE (should 405):

```bash
curl -o /dev/null -w "%{http_code}\n" -X GET  http://localhost:3010/mcp
curl -o /dev/null -w "%{http_code}\n" -X DELETE http://localhost:3010/mcp
```

Correct raw JSON-RPC curl against any HTTP variant (the doc's own curl
examples are missing the `Accept` header and the `jsonrpc`/`id` fields —
see the shared report):

```bash
curl -X POST http://localhost:3010/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

OAuth ("Server with Authentication") is intentionally not covered here —
delegated to the auth-doc verification agents.
