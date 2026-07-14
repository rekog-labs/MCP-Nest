# tool-discovery

Greenfield verification project for `docs/tool-discovery-and-registration.md`,
built against the published `@rekog/mcp-nest@2.0.0-alpha.1` package.

Demonstrates:
- Automatic discovery: `MyTools` (`@McpController()`) listed directly in
  `AppModule.controllers`, exposing `my-tool`.
- Grouping via feature modules: `AnalyticsFeatureModule` declares
  `AnalyticsTools` as a controller and `AnalyticsService` as a provider;
  `AppModule` imports the feature module (not listing `AnalyticsTools`
  directly) and the `count-items` tool is still discovered, with
  `AnalyticsService` injected successfully.

## Run

```bash
npm install
PORT=3007 npm start
```

## Test

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3007/mcp --transport http --method tools/list

bunx @modelcontextprotocol/inspector --cli http://localhost:3007/mcp --transport http --method tools/call --tool-name my-tool --tool-arg input=hello

bunx @modelcontextprotocol/inspector --cli http://localhost:3007/mcp --transport http --method tools/call --tool-name count-items --tool-arg items='["a","b","c"]'
```

Both tools were verified working over the wire; matches the documentation.
