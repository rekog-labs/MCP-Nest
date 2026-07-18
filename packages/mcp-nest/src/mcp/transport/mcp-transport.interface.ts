import { HttpServer, Logger } from '@nestjs/common';
import { McpServer } from "@modelcontextprotocol/server";
import { McpServerOptions } from './mcp-server-options.interface';
import { McpSessionInfo, McpTransportKind } from './mcp-context';

/**
 * The surface a transport receives from the {@link McpStrategy} when it starts.
 * Transports own the wire protocol; the strategy owns capability discovery,
 * the MCP request handlers, and routing into the NestJS RPC pipeline.
 */
export interface McpTransportContext {
  /**
   * Create a bare SDK `McpServer` (capabilities derived from discovery + any
   * `serverMutator` applied). The caller is responsible for connecting it to an
   * SDK transport and for calling {@link bindRequestHandlers}.
   */
  createServer(): McpServer;

  /**
   * (Re)register the MCP request handlers (tools/resources/prompts) on a server,
   * bound to a specific incoming request. Call this per request for session-aware
   * transports so the per-request `rawRequest` (auth context) is current.
   */
  bindRequestHandlers(
    server: McpServer,
    session: Pick<McpSessionInfo, 'transport' | 'stateless' | 'sessionId'>,
    rawRequest?: unknown,
  ): void;

  /** The Nest HTTP adapter. Present whenever an HTTP-based transport is used. */
  httpAdapter?: HttpServer;

  /** The resolved strategy options. */
  options: McpServerOptions;

  /** A logger scoped to the MCP server. */
  logger: Logger;
}

/**
 * A single MCP integration (stdio or streamable-HTTP). Implementations
 * are plain objects the user constructs and passes via {@link McpServerOptions.transports}.
 */
export interface McpTransport {
  readonly kind: McpTransportKind;
  /** Called once from {@link McpStrategy.listen}. */
  start(ctx: McpTransportContext): Promise<void> | void;
  /** Called from {@link McpStrategy.close}. */
  close(): Promise<void> | void;
}
