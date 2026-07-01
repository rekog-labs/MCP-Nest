import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';

/**
 * The MCP runtime objects live in their own file so both `main.ts` (which
 * builds the module + bootstraps) and `mcp-http.controller.ts` (which binds the
 * HTTP route to the transport) can import them without a circular dependency.
 *
 * Note: no `endpoint` and no `mount` here. `mcp-http.controller.ts` does
 * `extends McpHttpControllerFor(mcpTransport)`, which makes that controller own
 * the `/mcp` route and auto-disables the transport's self-mount. The path lives
 * on the controller's `@Controller('mcp')`, not on the transport.
 *
 * Stateful mode (the default) is used on purpose: one MCP session spans several
 * HTTP requests (`initialize`, then `tools/list`, then each `tools/call`, plus a
 * GET SSE stream), which makes the HTTP-layer pieces visibly fire more than once.
 */
// Stateful: this demo reuses one session across several HTTP requests (plus a
// GET SSE stream), so the HTTP-layer pieces fire more than once. Stateless is
// the default, so opt in with `statefulMode: true`.
export const mcpTransport = new StreamableHttpTransport({
  statefulMode: true,
});

export const mcpStrategy = new McpStrategy({
  name: 'custom-controllers-server',
  version: '1.0.0',
  transports: [mcpTransport],
});
