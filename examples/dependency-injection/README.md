# docs/dependency-injection.md verification

Greenfield project against the published `@rekog/mcp-nest@2.0.0-alpha.1`
package, verifying every claim in `docs/dependency-injection.md`.

## What's covered

- `src/user.repository.ts` — plain `@Injectable()` service (singleton scope).
- `src/greeting.tool.ts` — the doc's `GreetingTool` example: constructor
  injection of `UserRepository` into an `@McpController()`, tool `hello-world`.
- `src/request-scoped.tool.ts` — `@McpController({ scope: Scope.REQUEST })`
  with `@Inject(REQUEST)` and `@McpRawRequest()`, tool `inspect-request`,
  used to verify the "Request-scoped behavior" section.
- `src/greeting.resource.ts` / `src/greeting.prompt.ts` — inject the same
  `UserRepository` to verify the "Works With All MCP Types" claim.

## Run

```bash
npm install
PORT=3004 npm start
```

## Test

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3004/mcp --transport http --method tools/list
bunx @modelcontextprotocol/inspector --cli http://localhost:3004/mcp --transport http --method tools/call --tool-name hello-world --tool-arg name=World
bunx @modelcontextprotocol/inspector --cli http://localhost:3004/mcp --transport http --method tools/call --tool-name inspect-request
bunx @modelcontextprotocol/inspector --cli http://localhost:3004/mcp --transport http --method resources/read --uri mcp://users/world
bunx @modelcontextprotocol/inspector --cli http://localhost:3004/mcp --transport http --method prompts/get --prompt-name greet-known-user --prompt-args name=Alice
```

## Result

All documented DI patterns work as described, with one inaccuracy in the
doc's wording about what `@Inject(REQUEST)` resolves to — see the shared
report (`.rinorism/doc-report.md`) for details.
