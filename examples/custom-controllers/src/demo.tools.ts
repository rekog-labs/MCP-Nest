import { McpController, Tool } from '@rekog/mcp-nest';
import { UseFilters, UseInterceptors } from '@nestjs/common';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import {
  AuditInterceptor,
  RpcLoggingExceptionFilter,
  RpcLoggingInterceptor,
} from './rpc-layer';

/**
 * The RPC-layer capability controller.
 *
 * `@McpController` makes this a NestJS microservice controller (its `@Tool`
 * methods are RPC handlers), so the RPC interceptor + exception filter below
 * apply to every tool call — declared exactly the way you'd decorate an HTTP
 * controller.
 *
 * There is intentionally no middleware here: middleware is HTTP-only and cannot
 * attach to an `@McpController` (see `http-layer.ts`).
 *
 * Granularity: the class-level `@UseInterceptors(RpcLoggingInterceptor)` runs for
 * EVERY tool here, while `greet` adds a method-level `@UseInterceptors(
 * AuditInterceptor)` that runs for `greet` ONLY. They stack — `greet` fires both;
 * `boom` fires only the class-level one.
 */
@McpController()
@UseInterceptors(RpcLoggingInterceptor)
@UseFilters(RpcLoggingExceptionFilter)
export class DemoTools {
  @Tool({
    name: 'greet',
    description:
      'Returns a greeting (watch the RPC interceptor tag the result)',
    parameters: z.object({ name: z.string().describe('Who to greet') }),
  })
  @UseInterceptors(AuditInterceptor) // method-level: applies to `greet` only
  greet(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
  }

  @Tool({
    name: 'boom',
    description: 'Always throws — demonstrates the RPC exception filter',
    parameters: z.object({}),
  })
  boom() {
    throw new Error('intentional failure (RPC layer)');
  }
}
