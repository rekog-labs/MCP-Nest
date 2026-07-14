# multiple-servers

Verifies `docs/multiple-servers.md` against `@rekog/mcp-nest@2.0.0-alpha.1`.

Two named MCP servers (`weather`, `travel`) on one Nest app, mounted at
`/weather/mcp` and `/travel/mcp` on the same HTTP port. `TravelTools` reuses
`WeatherService` via DI, as shown in the doc.

```bash
npm install
PORT=3008 npm start
```

Test:

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3008/weather/mcp --transport http --method tools/list
bunx @modelcontextprotocol/inspector --cli http://localhost:3008/travel/mcp  --transport http --method tools/list
```
