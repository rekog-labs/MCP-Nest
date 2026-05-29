import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { HttpAdapterFactory } from '../../adapters/http-adapter.factory';
import { McpTransport, McpTransportContext } from '../mcp-transport.interface';
import { readJsonBody } from './read-body';

export interface SseTransportOptions {
  /** Route the SSE stream is opened on. @default '/sse' */
  sseEndpoint?: string;
  /** Route clients POST JSON-RPC messages to. @default '/messages' */
  messagesEndpoint?: string;
  /** Send periodic keep-alive comments to prevent idle timeouts. @default true */
  pingEnabled?: boolean;
  /** Keep-alive interval in ms. @default 30000 */
  pingIntervalMs?: number;
}

interface SseSession {
  transport: SSEServerTransport;
  server: McpServer;
  ping?: NodeJS.Timeout;
}

/**
 * Legacy HTTP+SSE transport. `GET {sseEndpoint}` opens the event stream and
 * `POST {messagesEndpoint}?sessionId=...` delivers JSON-RPC messages. Requires
 * sticky sessions when running multiple instances.
 */
export class SseTransport implements McpTransport {
  readonly kind = 'sse' as const;

  private readonly sseEndpoint: string;
  private readonly messagesEndpoint: string;
  private readonly pingEnabled: boolean;
  private readonly pingIntervalMs: number;

  private readonly sessions = new Map<string, SseSession>();
  private ctx?: McpTransportContext;

  constructor(options: SseTransportOptions = {}) {
    this.sseEndpoint = ensureLeadingSlash(options.sseEndpoint ?? 'sse');
    this.messagesEndpoint = ensureLeadingSlash(
      options.messagesEndpoint ?? 'messages',
    );
    this.pingEnabled = options.pingEnabled ?? true;
    this.pingIntervalMs = options.pingIntervalMs ?? 30000;
  }

  start(ctx: McpTransportContext): void {
    if (!ctx.httpAdapter) {
      throw new Error(
        'SseTransport requires an HTTP adapter. Pass it via new McpStrategy({ httpAdapter }) or strategy.setHttpAdapter(app.getHttpAdapter()).',
      );
    }
    this.ctx = ctx;
    const adapter = ctx.httpAdapter as unknown as {
      get(path: string, handler: (req: any, res: any) => unknown): unknown;
      post(path: string, handler: (req: any, res: any) => unknown): unknown;
    };
    adapter.get(this.sseEndpoint, (req, res) => this.handleSse(req, res));
    adapter.post(this.messagesEndpoint, (req, res) =>
      this.handleMessage(req, res),
    );
    ctx.logger.log(
      `MCP sse transport mounted (GET ${this.sseEndpoint}, POST ${this.messagesEndpoint})`,
    );
  }

  async close(): Promise<void> {
    for (const session of this.sessions.values()) {
      if (session.ping) clearInterval(session.ping);
      await session.transport.close().catch(() => undefined);
      await session.server.close().catch(() => undefined);
    }
    this.sessions.clear();
  }

  private async handleSse(req: any, res: any): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedRes = adapter.adaptResponse(res);

    const transport = new SSEServerTransport(
      this.messagesEndpoint,
      adaptedRes.raw,
    );
    const sessionId = transport.sessionId;
    const server = this.ctx!.createServer();

    const session: SseSession = { transport, server };
    this.sessions.set(sessionId, session);

    if (this.pingEnabled) {
      session.ping = setInterval(() => {
        try {
          if (adaptedRes.raw.writableEnded) return;
          adaptedRes.raw.write(': ping\n\n');
        } catch {
          // ignore write errors on closed connections
        }
      }, this.pingIntervalMs);
      session.ping.unref?.();
    }

    transport.onclose = () => {
      if (session.ping) clearInterval(session.ping);
      this.sessions.delete(sessionId);
    };

    await server.connect(transport);
  }

  private async handleMessage(req: any, res: any): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedReq = adapter.adaptRequest(req);
    const adaptedRes = adapter.adaptResponse(res);
    const sessionId = adaptedReq.query.sessionId as string;
    const session = this.sessions.get(sessionId);

    if (!session) {
      adaptedRes.status(404).send('Session not found');
      return;
    }

    // Bind handlers with the per-request auth context before processing.
    this.ctx!.bindRequestHandlers(
      session.server,
      { transport: this.kind, stateless: false, sessionId },
      adaptedReq.raw,
    );

    const body = await readJsonBody(adaptedReq);
    await session.transport.handlePostMessage(
      adaptedReq.raw,
      adaptedRes.raw,
      body,
    );
  }
}

function ensureLeadingSlash(endpoint: string): string {
  const trimmed = endpoint.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
