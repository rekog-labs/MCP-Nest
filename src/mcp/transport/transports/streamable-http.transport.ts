import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { HttpAdapterFactory } from '../../adapters/http-adapter.factory';
import { HttpResponse } from '../../interfaces/http-adapter.interface';
import { McpTransport, McpTransportContext } from '../mcp-transport.interface';
import { readJsonBody } from './read-body';

export interface StreamableHttpTransportOptions {
  /** Route the MCP endpoint is mounted at. @default '/mcp' */
  endpoint?: string;
  /** Disable session management (one server per request). @default false */
  statelessMode?: boolean;
  /** Return JSON responses instead of SSE streams. @default false */
  enableJsonResponse?: boolean;
  /** Custom session id generator (stateful mode). */
  sessionIdGenerator?: () => string;
}

/**
 * Streamable-HTTP transport. Mounts `POST`/`GET`/`DELETE` on the Nest HTTP server
 * and delegates to the MCP SDK `StreamableHTTPServerTransport`. Supports both the
 * stateless (one server per request) and stateful (session-managed) modes.
 */
export class StreamableHttpTransport implements McpTransport {
  readonly kind = 'streamable-http' as const;

  private readonly endpoint: string;
  private readonly statelessMode: boolean;
  private readonly enableJsonResponse: boolean;
  private readonly sessionIdGenerator: () => string;

  private readonly transports: Record<string, StreamableHTTPServerTransport> =
    {};
  private readonly servers: Record<string, McpServer> = {};
  private ctx?: McpTransportContext;

  constructor(options: StreamableHttpTransportOptions = {}) {
    this.endpoint = ensureLeadingSlash(options.endpoint ?? 'mcp');
    this.statelessMode = options.statelessMode ?? false;
    this.enableJsonResponse = options.enableJsonResponse ?? false;
    this.sessionIdGenerator =
      options.sessionIdGenerator ?? (() => randomUUID());
  }

  start(ctx: McpTransportContext): void {
    if (!ctx.httpAdapter) {
      throw new Error(
        'StreamableHttpTransport requires an HTTP adapter. Pass it via new McpStrategy({ httpAdapter }) or strategy.setHttpAdapter(app.getHttpAdapter()).',
      );
    }
    this.ctx = ctx;
    const adapter = ctx.httpAdapter as unknown as {
      post(path: string, handler: (req: any, res: any) => unknown): unknown;
      get(path: string, handler: (req: any, res: any) => unknown): unknown;
      delete(path: string, handler: (req: any, res: any) => unknown): unknown;
    };

    adapter.post(this.endpoint, (req, res) => this.handlePost(req, res));
    adapter.get(this.endpoint, (req, res) => this.handleGet(req, res));
    adapter.delete(this.endpoint, (req, res) => this.handleDelete(req, res));

    ctx.logger.log(
      `MCP streamable-http transport mounted at ${this.endpoint} (${this.statelessMode ? 'stateless' : 'stateful'})`,
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
      if (this.statelessMode) {
        await this.handleStateless(adaptedReq, adaptedRes, body);
      } else {
        await this.handleStateful(adaptedReq, adaptedRes, body);
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

    if (this.statelessMode) {
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

    if (this.statelessMode) {
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
