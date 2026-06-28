import { Controller, UseFilters, UseInterceptors } from '@nestjs/common';
import { McpHttpControllerFor } from '@rekog/mcp-nest';
import { HttpDemoExceptionFilter, HttpTimingInterceptor } from './http-layer';
import { mcpTransport } from './mcp.runtime';

/**
 * The HTTP-layer controller: the actual `/mcp` route MCP clients connect to.
 *
 * `McpHttpControllerFor(mcpTransport)` gives us the POST/GET/DELETE verb wiring
 * (sessions, SSE, raw-body) bound to that transport; we add only what is
 * specific to this route — the path and the HTTP-layer interceptor/filter.
 *
 * By convention this class is named `McpHttpController`, never `McpController` —
 * that bare name belongs to the `@McpController` decorator on the capability
 * class (`demo.tools.ts`). Two controllers, two layers.
 *
 * Middleware for this route is wired in `server.ts` via `configure()` (middleware
 * is attached at the module level, not with a decorator).
 */
@Controller('mcp')
@UseInterceptors(HttpTimingInterceptor)
@UseFilters(HttpDemoExceptionFilter)
export class McpHttpController extends McpHttpControllerFor(mcpTransport) {}
