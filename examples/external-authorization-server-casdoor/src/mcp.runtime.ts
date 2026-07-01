import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';

/**
 * The MCP runtime objects live here (not in `main.ts`) so both `main.ts` and
 * `mcp.controller.ts` can import them without a circular dependency:
 *
 * - `main.ts` connects the strategy as a microservice and starts it.
 * - `mcp.controller.ts` binds `McpHttpController` to `mcpTransport` via
 *   `McpHttpControllerFor(mcpTransport)`, so that controller owns the `/mcp`
 *   route and `CasdoorAuthGuard` runs on it.
 *
 * Note there is no `mount: false` here: `McpHttpControllerFor(mcpTransport)`
 * reads `mcpTransport.httpHandlers` at class-definition time, which auto-disables
 * the transport's own self-mount. Pass `mount: true`/`false` only to override.
 *
 * `endpoint: '/mcp'` matches the `@Controller('mcp')` in `mcp.controller.ts`;
 * because the controller owns the route it is cosmetic, but keeping the two in
 * sync avoids confusion.
 */
export const mcpTransport = new StreamableHttpTransport({
  endpoint: '/mcp',
});

export const mcpStrategy = new McpStrategy({
  name: 'external-auth-mcp-server',
  version: '0.0.1',
  transports: [mcpTransport],
});
