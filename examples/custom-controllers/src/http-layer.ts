import {
  ArgumentsHost,
  CallHandler,
  Catch,
  ExceptionFilter,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
  NestMiddleware,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

/**
 * ============================================================================
 *  HTTP LAYER pieces — they attach to the `McpHttpController` route.
 * ============================================================================
 *
 * Everything in this file operates on the raw HTTP request/response, BEFORE the
 * MCP protocol is involved. They fire on EVERY transport request a client makes:
 * `initialize`, `tools/list`, the GET SSE stream, every `tools/call`, etc. — one
 * MCP session is many HTTP requests.
 *
 * Contrast with `rpc-layer.ts`, whose pieces fire once per *tool call* and see
 * the parsed tool name + arguments.
 */

/**
 * Decode a parsed JSON-RPC HTTP body into a short, readable label so the logs
 * say WHICH MCP message a `POST /mcp` actually was.
 *
 * IMPORTANT: this only ever reads `req.body` (already buffered by Nest's body
 * parser). It never touches the raw request stream — the transport reads the
 * body itself (see `src/mcp/transport/transports/read-body.ts`, which prefers
 * `req.body`), and consuming the stream here would starve it and break the call.
 *
 * Handles the three shapes that occur at the boundary:
 *  - a single JSON-RPC object  → `initialize`, `tools/list`, `tools/call (greet)`
 *  - a batch array             → `[initialize, tools/list]`
 *  - no/empty body (GET, etc.) → `undefined` (caller labels by HTTP verb)
 */
function describeJsonRpc(body: unknown): string | undefined {
  if (Array.isArray(body)) {
    if (body.length === 0) return undefined;
    return `[${body.map((m) => describeJsonRpc(m) ?? '?').join(', ')}]`;
  }
  if (body && typeof body === 'object' && 'method' in body) {
    const b = body as { method?: string; params?: { name?: string } };
    if (b.method === 'tools/call' && b.params?.name) {
      return `tools/call (${b.params.name})`;
    }
    return b.method;
  }
  return undefined;
}

/** Build an aligned `VERB /path → message` label for the demo logs. */
function requestLabel(req: Request): string {
  const desc = describeJsonRpc(req.body);
  const verb = req.method.padEnd(4);
  if (desc) return `${verb} ${req.originalUrl} → ${desc}`;
  if (req.method === 'GET') return `${verb} ${req.originalUrl} (SSE stream)`;
  if (req.method === 'DELETE') return `${verb} ${req.originalUrl} (session end)`;
  return `${verb} ${req.originalUrl}`;
}

/**
 * Middleware — HTTP-only. There is NO middleware on the RPC (`@McpController`)
 * side, because middleware is an HTTP concept (it sits in the HTTP request
 * pipeline). The RPC-layer equivalents are guards / interceptors / pipes.
 *
 * Stamps a request id and logs every incoming transport request, decoding the
 * MCP method too. In this Express app Nest's global body parser runs before
 * route middleware, so `req.body` is already populated here and the method shows
 * on both the `[http-middleware]` and `[http-interceptor]` lines. The decode stays
 * defensive (`describeJsonRpc` returns undefined for an unparsed/empty body, and
 * the line falls back to verb+path) so it can't crash if the ordering differs.
 */
@Injectable()
export class HttpLoggingMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const id = Math.random().toString(36).slice(2, 8);
    (req as Request & { demoReqId?: string }).demoReqId = id;
    console.log(`[http-middleware] ${requestLabel(req).padEnd(40)} reqId=${id}`);
    next();
  }
}

/**
 * Interceptor — wraps the route handler. Good for timing/logging at the HTTP
 * layer. It must NOT try to rewrite the response body: the MCP verb handlers use
 * `@Res()` (manual response mode) and the transport streams the response itself,
 * so there is no return value to map over. We only measure and log.
 *
 * To make the HTTP exception filter observable, this interceptor deliberately
 * throws when the request carries `x-demo-fail: http`.
 */
@Injectable()
export class HttpTimingInterceptor implements NestInterceptor {
  /** So the full-body dump (below) happens for exactly ONE tools/call. */
  private dumped = false;

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const id = (req as Request & { demoReqId?: string }).demoReqId ?? '?';

    if (req.headers['x-demo-fail'] === 'http') {
      // Thrown from the controller context → caught by HttpDemoExceptionFilter.
      throw new HttpException(
        'Injected HTTP-layer failure (x-demo-fail: http)',
        418,
      );
    }

    const label = requestLabel(req);

    // Once, on a tools/call, print the ENTIRE JSON-RPC body so a reader can see
    // what a raw MCP message actually looks like at the HTTP boundary. Reading
    // `req.body` (already parsed) does NOT disturb the transport.
    if (!this.dumped && describeJsonRpc(req.body)?.startsWith('tools/call')) {
      this.dumped = true;
      console.log(
        `[http-interceptor] full JSON-RPC body for this request:\n${JSON.stringify(req.body, null, 2)}`,
      );
    }

    const start = Date.now();
    return next.handle().pipe(
      finalize(() => {
        console.log(
          `[http-interceptor] ${label.padEnd(40)} reqId=${id} took ${Date.now() - start}ms`,
        );
      }),
    );
  }
}

/**
 * Exception filter — controller-scoped. Catches exceptions thrown WITHIN the
 * controller context (its guards/interceptors/handler), turning them into an
 * HTTP response.
 *
 * Honest caveat: this does NOT catch exceptions thrown in *middleware* —
 * middleware runs before controller-scoped filters are in scope, so a throw
 * there would go to a GLOBAL filter instead. That's why we trigger the demo
 * failure from the interceptor, not the middleware.
 */
@Catch()
export class HttpDemoExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    const message =
      exception instanceof Error ? exception.message : 'Unknown error';

    console.log(`[http-filter] caught: ${message} → responding ${status}`);

    // Shape it like a JSON-RPC error so an MCP client could still parse it.
    res.status(status).json({
      jsonrpc: '2.0',
      error: { code: -32099, message },
      id: null,
    });
  }
}
