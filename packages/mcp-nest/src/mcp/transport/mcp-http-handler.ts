/**
 * The HTTP verb handlers a streamable-HTTP MCP endpoint needs: one per method
 * the transport mounts (`POST` messages, `GET` SSE stream, `DELETE` session
 * teardown). This is the seam for "bring your own controller" setups.
 *
 * The transport owns the implementation (session handling, streaming, raw-body
 * reading); you only decide HOW the route is mounted:
 *
 * - Do nothing — the transport self-mounts the route (no guards possible).
 * - Extend {@link StreamableHttpController} (or write your own `@Controller`)
 *   and delegate to these handlers, so the route is a real Nest route that
 *   `@UseGuards()` / `@UseInterceptors()` / `@Version()` apply to.
 *
 * Obtain an instance from a transport via `transport.httpHandlers` and provide
 * it under {@link MCP_HTTP_HANDLER} so the controller can inject it.
 */
export interface McpHttpHandler {
  handlePost(req: unknown, res: unknown): Promise<void> | void;
  handleGet(req: unknown, res: unknown): Promise<void> | void;
  handleDelete(req: unknown, res: unknown): Promise<void> | void;
}

/**
 * DI token for an {@link McpHttpHandler}. Provide a transport's `httpHandlers`
 * under this token so {@link StreamableHttpController} (or your own controller)
 * can inject it:
 *
 * ```ts
 * { provide: MCP_HTTP_HANDLER, useValue: mcpTransport.httpHandlers }
 * ```
 */
export const MCP_HTTP_HANDLER = Symbol('MCP_HTTP_HANDLER');
