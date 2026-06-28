import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { HttpAdapterFactory } from '../../adapters/http-adapter.factory';
import { HttpResponse } from '../../interfaces/http-adapter.interface';
import { McpTransport, McpTransportContext } from '../mcp-transport.interface';
import type { McpHttpHandler } from '../mcp-http-handler';
import { readJsonBody } from './read-body';

export interface StreamableHttpTransportOptions {
  /**
   * Path of the transport's **self-mounted** route.
   *
   * This ONLY applies when the transport self-mounts (no controller owns the
   * route). A self-mounted route is registered directly on the HTTP adapter,
   * OUTSIDE Nest's routing pipeline — so it does not pick up
   * `app.setGlobalPrefix(...)`, URI versioning, guards, or interceptors. Use
   * `endpoint` for a trivial path change on a no-auth server.
   *
   * When you bring your own controller, the path comes from your
   * `@Controller(...)` decorator (and global prefix / versioning apply normally)
   * — `endpoint` is ignored. The transport logs a warning if you set it anyway.
   *
   * @default '/mcp'
   */
  endpoint?: string;
  /**
   * Enable session management (a long-lived MCP server per session, identified
   * by the `mcp-session-id` header, with `GET`/`DELETE` support for SSE streams
   * and session teardown).
   *
   * Left off (the default), the transport is **stateless**: every request is
   * self-contained, a fresh server is created and torn down per request, and
   * `GET`/`DELETE` return `405`. Stateless is the simplest mode and the right
   * default for most servers; turn this on only when you need server-initiated
   * streaming/notifications tied to a session.
   *
   * @default false (stateless)
   */
  statefulMode?: boolean;
  /**
   * Return a single JSON response instead of opening an SSE stream.
   *
   * When unset, this **follows the session mode**: `true` in stateless mode (so
   * a plain POST gets a JSON reply with no stream to manage) and `false` in
   * stateful mode (SSE, so server-initiated messages can flow). Set it
   * explicitly to override that pairing.
   *
   * @default `!statefulMode` (JSON when stateless, SSE when stateful)
   */
  enableJsonResponse?: boolean;
  /** Custom session id generator (stateful mode). */
  sessionIdGenerator?: () => string;
  /**
   * Whether the transport mounts its own `POST`/`GET`/`DELETE` routes on the
   * Nest HTTP adapter.
   *
   * Leave it unset (the default) for **auto-detection**: the transport
   * self-mounts UNLESS something has read {@link httpHandlers} — which happens
   * exactly when you wire a bring-your-own `@Controller` (e.g. via
   * `{ provide: MCP_HTTP_HANDLER, useValue: transport.httpHandlers }`). So
   * providing a controller automatically suppresses self-mounting; doing
   * nothing keeps the zero-config self-mount. This read happens at module
   * definition time, before the transport starts, so the timing is reliable.
   *
   * Set it explicitly to override the heuristic:
   * - `true`: always self-mount (bypasses the Nest pipeline — no guards).
   * - `false`: never self-mount (you own the route via a controller).
   *
   * @default undefined (auto: self-mount unless `httpHandlers` was accessed)
   */
  mount?: boolean;
}

/**
 * Streamable-HTTP transport. Mounts `POST`/`GET`/`DELETE` on the Nest HTTP server
 * and delegates to the MCP SDK `StreamableHTTPServerTransport`. Supports both the
 * stateless (one server per request) and stateful (session-managed) modes.
 */
export class StreamableHttpTransport implements McpTransport {
  readonly kind = 'streamable-http' as const;

  private readonly endpoint: string;
  private readonly statefulMode: boolean;
  private readonly enableJsonResponse: boolean;
  private readonly sessionIdGenerator: () => string;
  /** Whether `endpoint` was set explicitly (vs defaulted) — for the ignored-option warning. */
  private readonly endpointExplicit: boolean;
  /** Explicit `mount` override; `undefined` means auto-detect. */
  private readonly mountOption?: boolean;
  /** Set the first time {@link httpHandlers} is read — implies a BYO controller. */
  private handlersClaimed = false;

  private readonly transports: Record<string, StreamableHTTPServerTransport> =
    {};
  private readonly servers: Record<string, McpServer> = {};
  private ctx?: McpTransportContext;

  constructor(options: StreamableHttpTransportOptions = {}) {
    this.endpoint = ensureLeadingSlash(options.endpoint ?? 'mcp');
    this.endpointExplicit = options.endpoint !== undefined;
    this.statefulMode = options.statefulMode ?? false;
    // Default follows the session mode: JSON in stateless, SSE in stateful.
    this.enableJsonResponse =
      options.enableJsonResponse ?? !this.statefulMode;
    this.sessionIdGenerator =
      options.sessionIdGenerator ?? (() => randomUUID());
    this.mountOption = options.mount;
  }

  /**
   * The HTTP verb handlers, for bring-your-own-controller setups. Provide this
   * under `MCP_HTTP_HANDLER` and delegate to it from a `@Controller` (see
   * {@link StreamableHttpController}). The returned functions are bound to this
   * transport and read their context lazily, so it is safe to grab this getter
   * at module-construction time — before `start()` has run.
   *
   * Reading this getter also marks the route as claimed, so the transport
   * auto-disables its own self-mount (unless `mount` was set explicitly). That
   * is how `{ provide: MCP_HTTP_HANDLER, useValue: transport.httpHandlers }`
   * suppresses self-mounting without any extra flag.
   */
  get httpHandlers(): McpHttpHandler {
    this.handlersClaimed = true;
    return {
      handlePost: (req: unknown, res: unknown) => this.handlePost(req, res),
      handleGet: (req: unknown, res: unknown) => this.handleGet(req, res),
      handleDelete: (req: unknown, res: unknown) => this.handleDelete(req, res),
    };
  }

  start(ctx: McpTransportContext): void {
    // The context (server factory, request-handler binding, logger) is always
    // needed — the handlers read it lazily whether we self-mount or a user
    // controller calls them.
    this.ctx = ctx;

    // Auto-detect: self-mount unless a controller claimed the route by reading
    // `httpHandlers`. An explicit `mount` option overrides the heuristic.
    const shouldMount = this.mountOption ?? !this.handlersClaimed;

    if (!shouldMount) {
      // The path now comes from the user's @Controller(...), so a self-mount
      // `endpoint` would be silently ignored. Don't let that pass quietly.
      if (this.endpointExplicit) {
        ctx.logger.warn(
          `StreamableHttpTransport: \`endpoint: '${this.endpoint}'\` is ignored because a controller owns the route. Set the path on your @Controller(...) decorator instead (it also picks up global prefix and versioning).`,
        );
      }
      ctx.logger.log(
        `MCP streamable-http transport ready (${this.statefulMode ? 'stateful' : 'stateless'}, self-mount disabled — a controller owns the route)`,
      );
      return;
    }

    if (!ctx.httpAdapter) {
      throw new Error(
        'StreamableHttpTransport requires an HTTP adapter to self-mount. Pass it via new McpStrategy({ httpAdapter }) or strategy.setHttpAdapter(app.getHttpAdapter()) — or mount your own controller (provide MCP_HTTP_HANDLER with transport.httpHandlers).',
      );
    }
    const adapter = ctx.httpAdapter as unknown as {
      post(path: string, handler: (req: any, res: any) => unknown): unknown;
      get(path: string, handler: (req: any, res: any) => unknown): unknown;
      delete(path: string, handler: (req: any, res: any) => unknown): unknown;
    };

    adapter.post(this.endpoint, (req, res) => this.handlePost(req, res));
    adapter.get(this.endpoint, (req, res) => this.handleGet(req, res));
    adapter.delete(this.endpoint, (req, res) => this.handleDelete(req, res));

    ctx.logger.log(
      `MCP streamable-http transport mounted at ${this.endpoint} (${this.statefulMode ? 'stateful' : 'stateless'})`,
    );
  }

  async close(): Promise<void> {
    for (const sessionId of Object.keys(this.transports)) {
      await this.cleanupSession(sessionId);
    }
  }

  private async handlePost(req: any, res: any): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedReq = adapter.adaptRequest(req);
    const adaptedRes = adapter.adaptResponse(res);
    const body = await readJsonBody(adaptedReq);

    try {
      if (this.statefulMode) {
        await this.handleStateful(adaptedReq, adaptedRes, body);
      } else {
        await this.handleStateless(adaptedReq, adaptedRes, body);
      }
    } catch (error) {
      this.ctx!.logger.error('Error handling MCP request', error as Error);
      if (!adaptedRes.headersSent) {
        adaptedRes.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  }

  private async handleStateless(
    req: ReturnType<
      ReturnType<typeof HttpAdapterFactory.getAdapter>['adaptRequest']
    >,
    res: HttpResponse,
    body: unknown,
  ): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: this.enableJsonResponse,
    });
    const server = this.ctx!.createServer();
    await server.connect(transport);
    this.ctx!.bindRequestHandlers(
      server,
      { transport: this.kind, stateless: true },
      req.raw,
    );

    res.raw.on('finish', () => {
      void transport.close();
      void server.close();
    });

    await transport.handleRequest(req.raw, res.raw, body);
  }

  private async handleStateful(
    req: ReturnType<
      ReturnType<typeof HttpAdapterFactory.getAdapter>['adaptRequest']
    >,
    res: HttpResponse,
    body: unknown,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (!sessionId && isInitializeRequest(body)) {
      const server = this.ctx!.createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: this.sessionIdGenerator,
        enableJsonResponse: this.enableJsonResponse,
        onsessioninitialized: (sid: string) => {
          this.transports[sid] = transport;
          this.servers[sid] = server;
        },
        onsessionclosed: (sid: string) => {
          void this.cleanupSession(sid);
        },
      });
      await server.connect(transport);
      this.ctx!.bindRequestHandlers(
        server,
        { transport: this.kind, stateless: false },
        req.raw,
      );
      await transport.handleRequest(req.raw, res.raw, body);
      return;
    }

    if (sessionId) {
      const transport = this.transports[sessionId];
      const server = this.servers[sessionId];
      if (!transport || !server) {
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found' },
          id: null,
        });
        return;
      }
      // Re-bind so the per-request auth context is current.
      this.ctx!.bindRequestHandlers(
        server,
        { transport: this.kind, stateless: false, sessionId },
        req.raw,
      );
      await transport.handleRequest(req.raw, res.raw, body);
      return;
    }

    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: Mcp-Session-Id header is required',
      },
      id: null,
    });
  }

  private async handleGet(req: any, res: any): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedReq = adapter.adaptRequest(req);
    const adaptedRes = adapter.adaptResponse(res);

    if (!this.statefulMode) {
      adaptedRes.status(405).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed in stateless mode',
        },
        id: null,
      });
      return;
    }
    const sessionId = adaptedReq.headers['mcp-session-id'] as
      | string
      | undefined;
    const transport = sessionId ? this.transports[sessionId] : undefined;
    if (!transport) {
      adaptedRes.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found' },
        id: null,
      });
      return;
    }
    await transport.handleRequest(adaptedReq.raw, adaptedRes.raw);
  }

  private async handleDelete(req: any, res: any): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedReq = adapter.adaptRequest(req);
    const adaptedRes = adapter.adaptResponse(res);

    if (!this.statefulMode) {
      adaptedRes.status(405).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed in stateless mode',
        },
        id: null,
      });
      return;
    }
    const sessionId = adaptedReq.headers['mcp-session-id'] as
      | string
      | undefined;
    const transport = sessionId ? this.transports[sessionId] : undefined;
    if (!transport) {
      adaptedRes.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found' },
        id: null,
      });
      return;
    }
    await transport.handleRequest(adaptedReq.raw, adaptedRes.raw);
  }

  private async cleanupSession(sessionId: string): Promise<void> {
    const transport = this.transports[sessionId];
    const server = this.servers[sessionId];
    delete this.transports[sessionId];
    delete this.servers[sessionId];
    try {
      await transport?.close();
      await server?.close();
    } catch {
      // best-effort cleanup
    }
  }
}

function isInitializeRequest(body: unknown): boolean {
  const isInit = (msg: unknown): boolean =>
    typeof msg === 'object' &&
    msg !== null &&
    'method' in msg &&
    (msg as { method?: unknown }).method === 'initialize';
  return Array.isArray(body) ? body.some(isInit) : isInit(body);
}

function ensureLeadingSlash(endpoint: string): string {
  const trimmed = endpoint.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
