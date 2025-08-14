# Advanced MCP Server Pattern

This pattern demonstrates how to bypass the automatic controller factories and use MCP services (`McpSseService` and `McpStreamableHttpService`) directly in custom controllers for maximum control over your MCP server endpoints.

## When to Use This Pattern

Use this approach when you need:
- **Custom middleware**: Apply specific interceptors, guards, or pipes to MCP endpoints
- **Custom routing**: Define non-standard endpoint paths or add additional route parameters
- **Enhanced security**: Apply authentication/authorization at the controller level
- **Multiple configurations**: Use the same services with different endpoint configurations
- **Fine-grained control**: Full control over request/response handling beyond what the factories provide

## How to Implement

### Step 1: Disable Auto-Generated Controllers

Configure `McpModule.forRoot()` with empty transport array to disable automatic controller generation:

```typescript
McpModule.forRoot({
  name: 'my-server',
  version: '1.0.0',
  transport: [], // Disable all automatic controller generation
})
```

### Step 2: Create Custom Controllers

Define your controllers and inject the services:

```typescript
@Controller()
export class MyCustomSseController {
  constructor(private readonly mcpSseService: McpSseService) {}

  @Get('/my-custom-sse')
  @UseGuards(MyCustomGuard) // Apply custom guards
  async handleSse(@Req() req, @Res() res) {
    return this.mcpSseService.createSseConnection(req, res, 'messages', '');
  }
}
```

## Running the Example

```bash
npx ts-node-dev --respawn playground/servers/advanced/server-advanced.ts
```

## Testing with MCP Inspector

The server exposes standard MCP endpoints that can be tested with [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

- **SSE Transport**: `http://localhost:3030/sse`
- **Streamable HTTP Transport**: `http://localhost:3030/mcp`

Use MCP Inspector to connect to either endpoint and test tool calls, resource requests, and prompt interactions.

## Example Files

- `server-advanced.ts` - Complete server setup with disabled transports and manual service registration
- `sse.controller.ts` - Custom SSE controller implementation
- `streamable-http.controller.ts` - Custom Streamable HTTP controller implementation

## Key Implementation Details

### Controller Delegation Pattern

Controllers act as thin HTTP wrappers that delegate to the services:

```typescript
@Post('/messages')
async handleMessages(@Req() req, @Res() res, @Body() body) {
  await this.mcpSseService.handleMessage(req, res, body);
}
```

This maintains separation of concerns while giving you full control over the HTTP layer.