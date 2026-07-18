import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { McpServer } from "@modelcontextprotocol/server";
import { McpTransport, McpTransportContext } from '../mcp-transport.interface';

/**
 * stdio transport. Starts a single long-lived MCP server bound to the process'
 * stdin/stdout. Intended for CLI-style MCP servers launched by an MCP client.
 *
 * No HTTP adapter is required. As a persistent, session-aware connection, stdio
 * supports progress notifications and server-side logging.
 */
export class StdioTransport implements McpTransport {
  readonly kind = 'stdio' as const;

  private server?: McpServer;
  private transport?: StdioServerTransport;
  /** Prevent a stdio-only Node process from exiting during async Nest bootstrap. */
  private readonly bootstrapKeepAlive = setInterval(() => undefined, 2 ** 31 - 1);

  async start(ctx: McpTransportContext): Promise<void> {
    this.server = ctx.createServer();
    ctx.bindRequestHandlers(this.server, {
      transport: this.kind,
      stateless: false,
    });
    this.transport = new StdioServerTransport();
    await this.server.connect(this.transport);
    clearInterval(this.bootstrapKeepAlive);
    ctx.logger.log('MCP stdio transport started');
  }

  async close(): Promise<void> {
    clearInterval(this.bootstrapKeepAlive);
    await this.transport?.close();
    await this.server?.close();
    this.transport = undefined;
    this.server = undefined;
  }
}
