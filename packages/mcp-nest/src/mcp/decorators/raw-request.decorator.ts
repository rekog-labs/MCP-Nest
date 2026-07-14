import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { McpContext } from '../transport/mcp-context';

/**
 * Injects the raw transport request into an MCP capability handler — the MCP
 * analog of NestJS's `@Req()`.
 *
 * Returns the underlying HTTP request object (Express `Request` / Fastify
 * `FastifyRequest`) for HTTP-based transports, or `undefined` for STDIO, which
 * is stream-oriented and has no per-call request object. Annotate the parameter
 * with your framework's request type — the decorator itself does not type it,
 * exactly like `@Req()`:
 *
 * @example
 * ```typescript
 * import type { Request } from 'express';
 *
 * @Tool({ name: 'whoami', description: 'Echo the caller' })
 * whoami(@McpRawRequest() req?: Request) {
 *   return { content: [{ type: 'text', text: req?.ip ?? 'stdio' }] };
 * }
 * ```
 *
 * This is sugar for `ctx.getRawRequest()` on the `@Ctx()` context; reach for it
 * when the request is all you need from the context. Note that, like every
 * NestJS param decorator, using this means the data parameter must also be
 * annotated (with `@Payload()`).
 */
export const McpRawRequest = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    ctx.switchToRpc().getContext<McpContext>()?.getRawRequest(),
);
