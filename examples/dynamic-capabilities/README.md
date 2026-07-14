# dynamic-capabilities

Greenfield verification project for `docs/dynamic-capabilities.md`, built
against the published `@rekog/mcp-nest@2.0.0-alpha.1` package (not local repo
source).

Demonstrates: basic dynamic tool registration, loading tool config at
startup, `isPublic`/`requiredScopes`/`requiredRoles` metadata, dynamic
resources, dynamic prompts (with and without parameters), deregistration
(including remove-then-recall and remove-then-re-register), mixed
static (`@McpController`)/dynamic tools, registration from an external
NestJS module via a shared `MCP_STRATEGY` token, and multi-server isolation
of dynamically registered tools (`/mcp`, `/server-a/mcp`, `/server-b/mcp`).

## Run

```bash
npm install
PORT=3005 npm start
```

## Test

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3005/mcp --transport http --method tools/list
bunx @modelcontextprotocol/inspector --cli http://localhost:3005/mcp --transport http --method tools/call --tool-name search-knowledge --tool-arg query=hello
```
