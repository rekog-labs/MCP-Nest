# server-mutation

Greenfield verification project for `docs/server-mutation.md` against the
published `@rekog/mcp-nest@2.0.0-alpha.1`.

The canonical use of `serverMutator` is **instrumentation** — wrapping the MCP
server so every request the strategy dispatches is observed. That is the shape
of `Sentry.wrapMcpServerWithSentry`, which is what the mutator hook was
originally added for.

- `src/greeting.tool.ts` — baseline `@McpController` tool (`greet-user`).
- `src/mutators.ts`
  - `tracingMutator` — dependency-free analog of `Sentry.wrapMcpServerWithSentry`:
    wraps `server.server.setRequestHandler`, so it times/logs every request,
    **including the decorator tools** the strategy installs afterward.
  - `loggingMutator` — a second tiny mutator, to show composition.
  - `combinedMutator` — composes the two (`reduce`), mirroring the doc's
    "Using multiple mutators" section.
  - A commented block shows the real `Sentry.wrapMcpServerWithSentry` drop-in.
- `src/main.ts` — `McpStrategy` configured with `serverMutator: combinedMutator`.

## Run

```bash
PORT=3006 npm start
```

Then call the decorator tool and watch the server console for `[trace]` lines:

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3006/mcp \
  --transport http --method tools/call --tool-name greet-user --tool-arg name=Rinor
# server log: [trace] tools/call greet-user ok 1ms
```

## Why instrumentation, not tool-adding

The mutator receives the server *before* the strategy binds its
decorator-tool handlers, so **wrapping** existing dispatch works, but
**registering new tools** does not: with at least one `@Tool`-decorated method
anywhere in the app, tools added directly via `server.registerTool(...)` inside
a mutator are silently excluded from `tools/list` and return `Unknown tool` on
`tools/call`. `McpStrategy.bindToolHandlers` overwrites the tool request
handlers to enumerate only decorator-discovered tools. (With zero `@Tool`
decorators anywhere, `bindToolHandlers` short-circuits and mutator-registered
tools work — but that is a corner case, not the intended pattern.) See
`/home/rinor/explore/MCP-Nest/.rinorism/doc-report.md` for details.
