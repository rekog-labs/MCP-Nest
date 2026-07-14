# try-docs / tools

Greenfield project verifying every feature in [`docs/tools.md`](../../docs/tools.md)
against the published `@rekog/mcp-nest@2.0.0-alpha.1`.

## Run

```bash
npm install
npm start          # stateful Streamable HTTP server on http://localhost:3000/mcp
```

## Test (MCP Inspector CLI)

```bash
URL=http://localhost:3000/mcp

# List tools
bunx @modelcontextprotocol/inspector --cli $URL --transport http --method tools/list | jq '.tools[].name'

# Basic tool
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name greet-user --tool-arg name=Alice --tool-arg language=es

# Output schema (content + structuredContent)
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name greet-user-structured --tool-arg name=Charlie --tool-arg language=fr

# Progress reporting (returns final text; progress notifications stream over SSE)
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name process-data --tool-arg data=payload

# @McpRawRequest — reads a header off the raw request
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name whoami

# ctx.mcpRequest — reads the parsed JSON-RPC request (method + _meta)
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name inspect-request --tool-arg input=hi

# ctx.log — emits server-side log messages. They stream over the standing GET SSE
# channel (not the tools/call response), and only when the strategy declares
# `capabilities: { logging: {} }` (main.ts) — the CLI shows just the text result.
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name log-demo --tool-arg input=hi

# @Tool({ _meta }) — passthrough metadata visible on the tool in tools/list
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/list | jq '.tools[] | select(.name=="greet-user-meta")._meta'
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name greet-user-meta --tool-arg name=Alice

# Tool guard denial (no req.user) -> "Forbidden resource", isError:true
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name admin-action --tool-arg target=server

# Custom @UseFilters filter -> "[BOOM] kaboom", isError:true
bunx @modelcontextprotocol/inspector --cli $URL --transport http \
  --method tools/call --tool-name boom

# Default masking vs RpcException
bunx @modelcontextprotocol/inspector --cli $URL --transport http --method tools/call --tool-name throw-plain
bunx @modelcontextprotocol/inspector --cli $URL --transport http --method tools/call --tool-name throw-rpc

# Filters on a Resource / Prompt -> MCP error -32603
bunx @modelcontextprotocol/inspector --cli $URL --transport http --method resources/read --uri "mcp://my-resource"
bunx @modelcontextprotocol/inspector --cli $URL --transport http --method prompts/get   --prompt-name my-prompt
```

## Features covered (all ✅ on alpha.1)

| docs/tools.md section | Tool(s) | Result |
| --- | --- | --- |
| Basic tool, `@Payload`/`@Ctx`, `describe`→`inputSchema` | `greet-user` | ✅ matches doc |
| `@McpRawRequest()` | `whoami` | ✅ |
| `ctx.mcpRequest` (parsed JSON-RPC request) | `inspect-request` | ✅ |
| `ctx.log` (server-side logging) | `log-demo` | ✅ logs stream over GET SSE (needs `capabilities: { logging: {} }`) |
| `@Tool({ _meta })` passthrough | `greet-user-meta` | ✅ `_meta` on tool in `tools/list` |
| Progress reporting | `process-data` | ✅ returns final text |
| Output schema | `greet-user-structured` | ✅ `content` + `structuredContent` (see report) |
| Elicitation | `greet-user-interactive` | registers; CLI can't drive elicitation (documented) |
| `@UseFilters` on tool | `boom`, `my-tool` | ✅ surfaced with `isError: true` |
| `@UseFilters` on resource/prompt | `my-resource`, `my-prompt` | ✅ `-32603` with message |
| Default masking / `RpcException` | `throw-plain`, `throw-rpc` | ✅ matches doc |
| Tool guards (`@UseGuards`) | `admin-action`, `secure-action` | ✅ deny → `Forbidden resource`, `isError: true` |

See [`.rinorism/doc-report.md`](../../.rinorism/doc-report.md) for the (minor) doc mismatches found.
