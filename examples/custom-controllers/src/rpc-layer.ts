import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { McpExceptionFilter } from '@rekog/mcp-nest';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';

/**
 * ============================================================================
 *  RPC LAYER pieces — they attach to the `@McpController` capability class.
 * ============================================================================
 *
 * `@Tool`/`@Resource`/`@Prompt` methods are NestJS microservice (`@MessagePattern`)
 * RPC handlers, so the full RPC pipeline applies: guards, pipes, interceptors,
 * and exception filters — declared with the same `@UseInterceptors`/`@UseFilters`
 * decorators you'd use on an HTTP controller, but running in the RPC pipeline.
 *
 * Unlike the HTTP-layer pieces, these fire ONCE PER TOOL CALL (not per HTTP
 * request) and can rewrite the tool result.
 */

/**
 * Interceptor — runs around each tool invocation. Logs which capability ran and
 * how long it took, and tags the result text so you can see it took effect.
 *
 * (The HTTP-layer interceptor can't do this last part — there is no result to
 * map over once the transport has streamed the response.)
 */
@Injectable()
export class RpcLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const handler = `${context.getClass().name}.${context.getHandler().name}`;
    const start = Date.now();
    return next.handle().pipe(
      // On success: log + tag the result.
      map((result: unknown) => {
        console.log(`[rpc-interceptor] ${handler} took ${Date.now() - start}ms`);
        const r = result as { content?: Array<{ text?: string }> };
        if (r?.content?.[0]?.text !== undefined) {
          r.content[0].text += ' [rpc]';
        }
        return result;
      }),
      // On error (e.g. `boom`): still log — this interceptor runs for EVERY tool
      // in the class, so we want a line even when the handler throws (the result
      // is then shaped by the exception filter).
      tap({
        error: () =>
          console.log(
            `[rpc-interceptor] ${handler} threw after ${Date.now() - start}ms`,
          ),
      }),
    );
  }
}

/**
 * Interceptor — attached METHOD-LEVEL (on a single `@Tool`), not on the class.
 * Completes the granularity ladder: HTTP route → `@McpController` class → one
 * `@Tool` method. The RPC pipeline stacks them (global → controller → method),
 * so a tool with this decorator runs BOTH the class-level interceptor and this
 * one; a tool without it runs only the class-level one.
 *
 * Being in the RPC pipeline, it has the parsed args + `McpContext` available —
 * which is why per-tool auditing is a method-level interceptor/guard, not
 * middleware (middleware exists only at the HTTP layer).
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tool = context.getHandler().name;
    const start = Date.now();
    console.log(`[audit] ${tool} invoked`);
    return next.handle().pipe(
      tap(() => console.log(`[audit] ${tool} → ok (${Date.now() - start}ms)`)),
    );
  }
}

/**
 * Exception filter — extends the library's `McpExceptionFilter` (an
 * `RpcExceptionFilter`) so we get its behavior for free: it surfaces the REAL
 * error message of a thrown handler as an `isError: true` tool result, instead
 * of NestJS's default "Internal server error" masking. We only add a log line
 * so the filter is visible in the demo.
 *
 * Without this filter, `boom`'s `Error('intentional failure (RPC layer)')` would
 * reach the client as an opaque "Internal server error".
 */
@Catch()
export class RpcLoggingExceptionFilter extends McpExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const message =
      exception instanceof Error ? exception.message : String(exception);
    console.log(`[rpc-filter] caught: ${message} → surfacing real message`);
    return super.catch(exception, host);
  }
}
