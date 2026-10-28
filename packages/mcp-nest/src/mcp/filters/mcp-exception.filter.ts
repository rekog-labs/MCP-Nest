import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { RpcException } from '@nestjs/microservices';
import { Observable, throwError } from 'rxjs';

/**
 * Surfaces the real error message of any exception thrown by an MCP
 * tool/resource/prompt handler, instead of NestJS's default "Internal server
 * error" masking.
 *
 * By default NestJS's RPC pipeline masks any non-`RpcException` to a generic
 * "Internal server error" before the strategy can read it, so a plain
 * `throw new Error('Order #42 not found')` reaches the agent as an opaque
 * failure. That is a safe default (it avoids leaking internals), but it is poor
 * DX when the message is meant for the caller. Register this filter to opt into
 * passing the original message through:
 *
 * ```typescript
 * // Globally (recommended) — applies to every MCP handler, but never overrides
 * // a more specific `@UseFilters()` you put on a controller/method.
 * providers: [{ provide: APP_FILTER, useClass: McpExceptionFilter }]
 * // In a hybrid app, the MCP microservice only sees global filters with:
 * app.connectMicroservice({ strategy }, { inheritAppConfig: true });
 * ```
 *
 * ```typescript
 * // Or per controller/method:
 * @UseFilters(McpExceptionFilter)
 * @McpController()
 * class MyTools { ... }
 * ```
 *
 * The surfaced message becomes an `isError: true` tool result (or a JSON-RPC
 * error for resources/prompts), so the agent can tell a real failure from a
 * successful call. For input problems, prefer the built-in Zod validation
 * (a clear "Invalid parameters: …" result) or `throw new RpcException(...)` /
 * a NestJS exception — those are already surfaced without this filter.
 *
 * Because it is `@Catch()`-all, a global registration also sees errors from
 * plain HTTP controllers (and guards on the MCP route itself). Those are handed
 * to Nest's own `BaseExceptionFilter`, so HTTP clients get the usual status and
 * body (unknown errors stay masked as a 500). Registered via `APP_FILTER`, the
 * HTTP adapter is injected; registered by hand, pass it in like any
 * `BaseExceptionFilter`:
 *
 * ```typescript
 * app.useGlobalFilters(
 *   new McpExceptionFilter(app.get(HttpAdapterHost).httpAdapter),
 * );
 * ```
 *
 * Other contexts (`ws`, `graphql`) and non-MCP microservice transports are not
 * specially handled: they go through the MCP (RPC) branch below.
 */
@Catch()
export class McpExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): Observable<never> | void {
    if (host.getType() === 'http') {
      return super.catch(exception, host);
    }
    // RpcException already carries an explicit, client-facing payload.
    if (exception instanceof RpcException) {
      return throwError(() => exception.getError());
    }
    const message =
      exception instanceof Error ? exception.message : 'Internal server error';
    return throwError(() => ({ status: 'error', message }));
  }
}
