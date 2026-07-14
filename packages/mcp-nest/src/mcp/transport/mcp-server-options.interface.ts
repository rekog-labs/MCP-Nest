import { Icon, ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { HttpServer } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpTransport } from './mcp-transport.interface';

/**
 * Configuration for an {@link McpStrategy} — the NestJS microservice transport
 * strategy that powers an MCP server. Pass an instance to
 * `app.connectMicroservice({ strategy: new McpStrategy(options) })`, set the HTTP
 * adapter for HTTP transports, and declare your `@McpController` classes in a
 * module's `controllers` array. No `McpModule` is required.
 */
export interface McpServerOptions {
  /** Server name (MCP `Implementation.name`). */
  name: string;
  /** Server version (MCP `Implementation.version`). */
  version: string;
  /**
   * Logical server name used for multi-server isolation. Only
   * `@McpController({ server: <name> })` classes bind to this strategy. Omit for
   * the default server (binds to plain `@McpController()` classes).
   */
  server?: string;
  /** Human-readable display name. */
  title?: string;
  /** Short description of what this server does. */
  description?: string;
  /** URL of the website associated with this server. */
  websiteUrl?: string;
  /** Icons representing this server. */
  icons?: Icon[];
  /** Extra MCP server capabilities merged with the auto-derived ones. */
  capabilities?: ServerCapabilities;
  /** Server instructions sent to clients on initialize. */
  instructions?: string;
  /** Mutate the SDK server right after creation (instrumentation, etc.). */
  serverMutator?: (server: McpServer) => McpServer;

  /**
   * The integrations this server exposes. Provide one entry per transport,
   * e.g. `[new StreamableHttpTransport(), new StdioTransport()]`.
   */
  transports: McpTransport[];

  /**
   * The Nest HTTP adapter, required for HTTP-based transports. Either pass it
   * here (`new McpStrategy({ ..., httpAdapter: app.getHttpAdapter() })`) or set
   * it later via `strategy.setHttpAdapter(app.getHttpAdapter())`. Not needed for
   * stdio-only servers.
   */
  httpAdapter?: HttpServer;

  /**
   * Freemium mode. When `true`, anonymous (unauthenticated) sessions may reach
   * `@PublicTool()` tools, while every other tool still requires a resolved
   * `req.user`. When `false` (default), per-tool listing/visibility trusts the
   * server's own authentication — `@UseGuards()` on `@McpController` classes or
   * methods (run by the NestJS RPC pipeline at call time) and/or auth middleware
   * on the HTTP routes.
   *
   * @default false
   */
  allowUnauthenticatedAccess?: boolean;
  /**
   * Logging configuration.
   * - `false` to disable MCP logging
   * - `{ level: [...] }` to filter levels
   * - `undefined` (default) for standard NestJS logging
   */
  logging?:
    | false
    | {
        level: ('log' | 'error' | 'warn' | 'debug' | 'verbose')[];
      };
}
