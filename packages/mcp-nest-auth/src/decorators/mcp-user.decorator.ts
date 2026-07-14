import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { McpContext } from '@rekog/mcp-nest';
import type { McpUserPayload } from '../interfaces/request-with-user';

/**
 * Injects the authenticated user into an MCP capability handler — the MCP analog
 * of the conventional NestJS `@User()`/`@CurrentUser()` decorator.
 *
 * Reads `request.user`, which is populated by {@link McpAuthJwtGuard} (or any
 * guard/middleware that sets it) off the raw transport request. This is the
 * auth-aware counterpart to core's `@McpRawRequest()`: where that hands you the
 * whole request, this projects straight to "who is authenticated".
 *
 * Pass a field name to extract a single property, mirroring NestJS's `@User()`:
 *
 * @example
 * ```typescript
 * @Tool({ name: 'whoami', description: 'Return the caller' })
 * whoami(@McpUser() user?: McpUserPayload) {
 *   return { content: [{ type: 'text', text: user?.name ?? 'anonymous' }] };
 * }
 *
 * // Or project a single field:
 * greet(@McpUser('email') email?: string) { ... }
 * ```
 *
 * Returns `undefined` when there is no authenticated user (e.g. an unauthenticated
 * request under `allowUnauthenticatedAccess`, or STDIO with no request). Like any
 * NestJS param decorator, using it means the data parameter must also be
 * annotated (with `@Payload()`).
 */
export const McpUser = createParamDecorator(
  (data: keyof McpUserPayload | undefined, ctx: ExecutionContext) => {
    const user = ctx
      .switchToRpc()
      .getContext<McpContext>()
      ?.getRawRequest<{ user?: McpUserPayload }>()?.user;
    return data ? user?.[data] : user;
  },
);
