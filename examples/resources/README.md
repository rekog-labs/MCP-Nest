# resources

Greenfield NestJS project verifying `docs/resources.md` against the published
`@rekog/mcp-nest@2.0.0-alpha.1` package.

## Run

```bash
npm install
PORT=3001 npm start
```

Server listens on `http://localhost:3001/mcp`.

## Test with MCP Inspector CLI

List resources:

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3001/mcp --transport http --method resources/list
```

Read each resource:

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3001/mcp --transport http --method resources/read --uri "mcp://languages/informal-greetings"
bunx @modelcontextprotocol/inspector --cli http://localhost:3001/mcp --transport http --method resources/read --uri "mcp://config/app"
bunx @modelcontextprotocol/inspector --cli http://localhost:3001/mcp --transport http --method resources/read --uri "mcp://help/usage"
bunx @modelcontextprotocol/inspector --cli http://localhost:3001/mcp --transport http --method resources/read --uri "mcp://docs/readme"
```

All four resources (`languages-informal-greetings`, `config-data`, `help-text`,
`readme`) from `docs/resources.md` are implemented in `src/greeting.resource.ts`
and confirmed working over the wire, matching the doc's stated expected output.
