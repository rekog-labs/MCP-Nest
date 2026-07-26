import { HttpServer, Logger } from '@nestjs/common';
import { McpServer } from "@modelcontextprotocol/server";
import { McpServerOptions } from './mcp-server-options.interface';
import { McpSessionSeed, McpTransportKind } from './mcp-context';
import type { ToolScopeDeficiency } from '../services/tool-authorization.service';

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
    session: McpSessionSeed,
    rawRequest?: unknown,
  ): void;

  /**
   * {@link createServer} + {@link bindRequestHandlers} in one call — the shape
   * the SDK serving entries expect from an `McpServerFactory`. They construct a
   * fresh instance per serving unit and own the transport, so the caller never
   * connects it.
   */
  createBoundServer(session: McpSessionSeed, rawRequest?: unknown): McpServer;

  /**
   * Ask whether a `tools/call` would be denied *purely* for lack of OAuth scope,
   * without dispatching it.
   *
   * Exists so a transport can answer such a call the way the MCP authorization
   * spec asks — `403` + `WWW-Authenticate: … error="insufficient_scope"`, the
   * trigger for client-side step-up authorization — which is only possible before
   * the JSON-RPC pipeline (and, on the modern era, the SDK's own response writer)
   * takes over the response. The strategy answers from the very same
   * `ToolAuthorizationService` that enforces the denial inside the pipeline, so
   * the pre-check can never disagree with the enforcement.
   *
   * `undefined` means "no scope-shaped denial here": authorized, an unknown tool,
   * no resolved `req.user`, or a role/authentication failure. See
   * `ToolAuthorizationService.findScopeDeficiency`.
   */
  toolCallScopeDeficiency(
    toolName: string,
    rawRequest?: unknown,
  ): ToolScopeDeficiency | undefined;

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

  /**
   * Announce that a capability list changed at runtime (via
   * `registerTool`/`removeTool` and friends).
   *
   * On protocol revision `2026-07-28` these events are delivered on
   * `subscriptions/listen` streams to the clients that opted into them —
   * there is no connection to broadcast down. Optional: transports with
   * nowhere to deliver simply omit it.
   */
  notifyListChanged?(kind: 'tools' | 'resources' | 'prompts'): void;
}
