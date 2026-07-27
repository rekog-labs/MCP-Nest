import {
  serveStdio,
  type StdioServerHandle,
} from '@modelcontextprotocol/server/stdio';
import { McpTransport, McpTransportContext } from '../mcp-transport.interface';

export interface StdioTransportOptions {
  /**
   * How a 2025-era opening (an `initialize` request, or any claim-less message)
   * is handled:
   *
   * - `'serve'` (the default) — the connection is pinned to a legacy instance
   *   and served exactly as before.
   * - `'reject'` — answer with the unsupported-protocol-version error naming the
   *   modern revisions this server speaks, and keep the connection open for a
   *   modern opening. Legacy clients cannot fall forward, so that error is the
   *   only diagnostic they will surface.
   *
   * @default 'serve'
   */
  legacy?: 'serve' | 'reject';
}

/**
 * stdio transport. Serves a single MCP connection bound to the process'
 * stdin/stdout, for CLI-style servers launched by an MCP client.
 *
 * The SDK's `serveStdio` entry owns the era decision: the opening exchange
 * selects it (a `server/discover` probe means modern, an `initialize` means
 * legacy), one server instance is pinned for the connection lifetime, and
 * everything after passes straight through to it.
 *
 * No HTTP adapter is required. As a persistent connection it supports progress
 * notifications and server-side logging on both eras.
 */
export class StdioTransport implements McpTransport {
  readonly kind = 'stdio' as const;

  private handle?: StdioServerHandle;
  private readonly legacy: 'serve' | 'reject';
  /** Prevent a stdio-only Node process from exiting during async Nest bootstrap. */
  private readonly bootstrapKeepAlive = setInterval(
    () => undefined,
    2 ** 31 - 1,
  );

  constructor(options: StdioTransportOptions = {}) {
    this.legacy = options.legacy ?? 'serve';
  }

  start(ctx: McpTransportContext): void {
    this.handle = serveStdio(
      // Called once per connection — plus once more for a `server/discover`
      // probe whose instance is discarded if the client falls back to
      // `initialize`. Construction must therefore stay side-effect free.
      (reqCtx) =>
        ctx.createBoundServer({
          transport: this.kind,
          // A stdio connection is long-lived on both eras: there is a live
          // channel for progress and logging, just no protocol session id.
          stateless: false,
          era: reqCtx.era,
        }),
      {
        legacy: this.legacy,
        onerror: (error) =>
          ctx.logger.error('MCP stdio transport error', error),
      },
    );
    clearInterval(this.bootstrapKeepAlive);
    ctx.logger.log('MCP stdio transport started');
  }

  async close(): Promise<void> {
    clearInterval(this.bootstrapKeepAlive);
    await this.handle?.close();
    this.handle = undefined;
  }
}
