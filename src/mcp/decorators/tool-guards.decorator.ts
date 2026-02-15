import { CanActivate, SetMetadata, Type } from '@nestjs/common';

/**
 * Metadata key for storing tool-level NestJS guards
 */
export const MCP_GUARDS_METADATA_KEY = 'mcp:guards';

/**
 * The execution context available to guards used with @ToolGuards().
 *
 * MCP tools don't run inside NestJS's request pipeline (all tools share a single
 * HTTP endpoint), so the full ExecutionContext is not available. This type
 * describes exactly what IS available.
 *
 * Available:
 * - `switchToHttp().getRequest()` - the real HTTP request object
 * - `getClass()` - the tool's provider class (works with Reflector)
 * - `getHandler()` - the tool's method reference (works with Reflector)
 * - `getType()` - always returns `'http'`
 *
 * Not available (will throw if called):
 * - `switchToHttp().getResponse()` - MCP handles responses via protocol layer
 * - `switchToHttp().getNext()` - no middleware chain
 * - `switchToRpc()` / `switchToWs()` - not an RPC/WS context
 * - `getArgs()` / `getArgByIndex()` - no NestJS argument array
 */
export interface ToolGuardExecutionContext {
  switchToHttp(): {
    getRequest<T = unknown>(): T;
  };
  getClass<T = unknown>(): Type<T>;
  getHandler(): Function;
  getType<TContext extends string = string>(): TContext;
}

/**
 * Decorator to specify NestJS guards that control access to a tool.
 *
 * When applied, each guard's `canActivate()` is evaluated before listing or executing the tool.
 * If any guard rejects, the tool is hidden from `tools/list` and blocked from execution.
 * ALL guards must pass (AND logic).
 *
 * Guards receive an execution context with the fields described by {@link ToolGuardExecutionContext}.
 * Standard NestJS guards that only use `switchToHttp().getRequest()` will work. Guards that
 * access the response object, RPC context, or WebSocket context will throw at runtime.
 *
 * Note: Guards require an HTTP context and are not supported with STDIO transport.
 * Tools with guards will be hidden when using STDIO.
 *
 * @param guards - Array of NestJS guard classes implementing CanActivate
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyTools {
 *   @Tool({ name: 'admin-action', description: 'Admin only' })
 *   @ToolGuards([AdminGuard])
 *   async adminAction() {
 *     return { content: [{ type: 'text', text: 'Done' }] };
 *   }
 *
 *   @Tool({ name: 'secure-action', description: 'Requires both guards' })
 *   @ToolGuards([AuthGuard, RoleGuard])
 *   async secureAction() {
 *     return { content: [{ type: 'text', text: 'Done' }] };
 *   }
 * }
 * ```
 */
export const ToolGuards = (guards: Type<CanActivate>[]) => {
  if (!Array.isArray(guards) || guards.length === 0) {
    throw new Error(
      '@ToolGuards() requires a non-empty array of guard classes',
    );
  }
  return SetMetadata(MCP_GUARDS_METADATA_KEY, guards);
};
