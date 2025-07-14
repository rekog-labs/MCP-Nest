# MCP-Nest Playground

A quick-start environment for testing and exploring MCP-Nest features without building a full application.

## Quick Start

### Option 1: Test with MCP Inspector (Recommended)

MCP Inspector provides a web-based UI to interact with your MCP server - perfect for testing tools, resources, and prompts visually.

#### For HTTP+SSE Transport (Stateful Server)

```bash
# 1. Start the stateful server
npx ts-node-dev --respawn ./playground/servers/server-stateful.ts

# 2. Launch MCP Inspector
npx @modelcontextprotocol/inspector

# 3. In your browser at http://127.0.0.1:6274:
#    - Set Transport Type to: SSE
#    - Set URL to: http://localhost:3030/sse
```

#### For Streamable HTTP Transport

```bash
# 1. Start the server (stateful or stateless)
npx ts-node-dev --respawn ./playground/servers/server-stateful.ts
# OR
npx ts-node-dev --respawn ./playground/servers/server-stateless.ts

# 2. Launch MCP Inspector
npx @modelcontextprotocol/inspector

# 3. In your browser at http://127.0.0.1:6274:
#    - Set Transport Type to: Streamable HTTP
#    - Set URL to: http://localhost:3030/mcp
```

#### For STDIO Transport

```bash
# 1. Run the MCP Inspector and configure it to use the STDIO server
npx @modelcontextprotocol/inspector@0.13.0 npx ts-node-dev --respawn playground/servers/stdio.ts


# 2. In your browser:
#    - Set Transport Type to: stdio
```

### Option 2: Test with Code Clients

Use code clients when you need to:

- Automate testing
- Build custom integrations
- Test specific scenarios programmatically

```bash
# Start your server first (choose one):
npx ts-node-dev --respawn ./playground/servers/server-stateful.ts
npx ts-node-dev --respawn ./playground/servers/server-stateless.ts

# Then run a client:
# For Streamable HTTP
npx ts-node-dev --respawn ./playground/clients/http-streamable-client.ts

# For HTTP+SSE (stateful server only)
npx ts-node-dev --respawn ./playground/clients/http-sse.ts

# For STDIO
npx ts-node-dev --respawn ./playground/clients/stdio-client.ts
```
