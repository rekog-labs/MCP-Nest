# docs/resource-templates.md verification

Greenfield project verifying `docs/resource-templates.md` against `@rekog/mcp-nest@2.0.0-alpha.1`.

## Run

```bash
npm install
PORT=3002 npm start
```

Server listens on `http://localhost:3002/mcp` (streamable HTTP, stateful).

## Test with MCP Inspector CLI

List templates:

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp --transport http --method resources/templates/list
```

Basic example (`GreetingResource`, matches the doc's "Basic Resource Template"):

```bash
bunx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp --transport http --method resources/read --uri "mcp://users/carlos"
bunx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp --transport http --method resources/read --uri "mcp://users/yuki"
bunx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp --transport http --method resources/read --uri "mcp://users/unknown"
```

URI template pattern claims (`PatternResource`, matches "URI Template Patterns" section):

```bash
# Single parameter
bunx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp --transport http --method resources/read --uri "mcp://accounts/123"

# Multiple parameters
bunx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp --transport http --method resources/read --uri "mcp://accounts/123/posts/456"

# Wildcard/catch-all (doc calls this section "Optional Parameters")
bunx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp --transport http --method resources/read --uri "mcp://docs/docs/readme.md"

# Confirms {path*} is NOT actually optional - requires at least one segment
bunx @modelcontextprotocol/inspector --cli http://localhost:3002/mcp --transport http --method resources/read --uri "mcp://docs"
```

## Findings

See `/home/rinor/explore/MCP-Nest/.rinorism/doc-report.md` for the full write-up. Summary:

- The basic `user-language` template works exactly as documented; parameter binding was verified with a user (`yuki`) not present in the doc's own examples, and it correctly bound and returned `ja`.
- Single-parameter, multi-parameter, and wildcard (`{path*}`) URI template patterns all match and extract parameters exactly as claimed.
- The doc's "Test with another user" example (section 3) reuses the exact same URI (`mcp://users/carlos`) as the first "Test with a known user" example instead of a different user, so it does not actually demonstrate a second case.
- The doc's "Optional Parameters" section heading is a mislabeling: `{path*}` is a wildcard/catch-all matching one-or-more segments, not a parameter that can be omitted. `mcp://docs` (zero segments) fails to resolve.
