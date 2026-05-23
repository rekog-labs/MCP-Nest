# Custom Controllers

This pattern demonstrates how to bypass the automatic controller factories and use `McpStreamableHttpService` directly in a custom controller for full control over your MCP server endpoints.

## When to Use This Pattern

Use this approach when you need:
- **Custom middleware**: Apply specific interceptors, guards, or pipes to MCP endpoints
- **Custom routing**: Define non-standard endpoint paths or add additional route parameters
- **Enhanced security**: Apply authentication/authorization at the controller level
- **Multiple configurations**: Use the same service with different endpoint configurations
- **Fine-grained control**: Full control over request/response handling beyond what the factories provide
- **Async configuration**: Combine with `McpModule.forRootAsync()` — see [Async Configuration](../../../docs/server-examples.md#async-configuration-forrootasync)

## How to Implement

### Step 1: Disable Auto-Generated Controllers

Configure `McpModule.forRoot()` with an empty transport array to disable automatic controller generation:

```typescript
McpModule.forRoot({
  name: 'my-server',
  version: '1.0.0',
  transport: [], // Disable controller generation
})
```

### Step 2: Create a Custom Controller

Define your controller and inject `McpStreamableHttpService`:

```typescript
@Controller()
export class StreamableHttpController {
  constructor(
    private readonly mcpStreamableHttpService: McpStreamableHttpService,
  ) {}

  @Post('/mcp')
  @UseGuards(MyCustomGuard) // Apply custom guards
  async handlePostRequest(
    @Req() req: any,
    @Res() res: any,
    @Body() body: unknown,
  ): Promise<void> {
    await this.mcpStreamableHttpService.handlePostRequest(req, res, body);
  }

  @Get('/mcp')
  async handleGetRequest(@Req() req: any, @Res() res: any): Promise<void> {
    await this.mcpStreamableHttpService.handleGetRequest(req, res);
  }

  @Delete('/mcp')
  async handleDeleteRequest(@Req() req: any, @Res() res: any): Promise<void> {
    await this.mcpStreamableHttpService.handleDeleteRequest(req, res);
  }
}
```

## Running the Example

```bash
npx ts-node-dev --respawn playground/servers/custom-controllers/server.ts
```

## Testing with MCP Inspector

The server exposes the standard Streamable HTTP endpoint that can be tested with [MCP Inspector](https://github.com/modelcontextprotocol/inspector):

- **Streamable HTTP Transport**: `http://localhost:3030/mcp`

Use MCP Inspector to connect and test tool calls, resource requests, and prompt interactions.

## Example Files

- `server.ts` - Complete server setup with disabled transports and manual controller registration
- `streamable-http.controller.ts` - Custom Streamable HTTP controller implementation

## Key Implementation Details

### Controller Delegation Pattern

The controller acts as a thin HTTP wrapper that delegates to the service:

```typescript
@Post('/mcp')
async handlePostRequest(@Req() req, @Res() res, @Body() body) {
  await this.mcpStreamableHttpService.handlePostRequest(req, res, body);
}
```

This maintains separation of concerns while giving you full control over the HTTP layer.