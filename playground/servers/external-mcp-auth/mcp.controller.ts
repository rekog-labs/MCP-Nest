import { Controller, UseGuards } from '@nestjs/common';
import { McpHttpControllerFor } from '@rekog/mcp-nest';
import { CasdoorAuthGuard } from './casdoor-auth.guard';
import { mcpTransport } from './mcp.runtime';

/**
 * The MCP endpoint, as a real NestJS controller.
 *
 * `McpHttpControllerFor(mcpTransport)` binds this controller to that transport
 * directly — the verb wiring (POST/GET/DELETE, sessions, SSE, raw-body) comes
 * from the library; we only add what's specific to THIS server: the path and the
 * guard. The binding is a concrete reference: jump to `mcpTransport` and you land
 * on the strategy that owns the tools. No DI token, no separate provider.
 *
 * Because it's an ordinary controller, the whole Nest pipeline composes here:
 * add `@UseInterceptors(...)`, `@UseFilters(...)`, `@Version(...)`, or stack more
 * guards, with no support from the library required.
 */
@Controller('mcp')
@UseGuards(CasdoorAuthGuard)
export class McpHttpController extends McpHttpControllerFor(mcpTransport) {}
