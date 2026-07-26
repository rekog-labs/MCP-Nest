import {
  Icon,
  ServerCapabilities,
  McpServer,
  type ServerOptions,
} from '@modelcontextprotocol/server';
import { HttpServer } from '@nestjs/common';
import { McpTransport } from './mcp-transport.interface';

/**
 * Per-operation cache hints for `2026-07-28` cacheable results (SEP-2549).
 *
 * Derived from the SDK's own option rather than restated, so neither the set of
 * cacheable operations (`tools/list`, `prompts/list`, `resources/list`,
 * `resources/templates/list`, `resources/read`, `server/discover`) nor the hint
 * shape (`{ ttlMs?, cacheScope? }`) can drift from what the SDK accepts.
 */
export type McpCacheHints = NonNullable<ServerOptions['cacheHints']>;

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
  /**
   * Cache hints for **modern-era** cacheable results (SEP-2549), keyed by
   * operation. Set here rather than per transport because the hint rides the SDK
   * server itself, so one setting covers every transport — streamable-HTTP and
   * stdio alike. Responses to 2025-era requests have no cache fields at all and
   * are never affected.
   *
   * Left unset, every cacheable result goes out with the SDK's conservative
   * default `{ ttlMs: 0, cacheScope: 'private' }` — i.e. no client ever caches
   * anything, which makes SEP-2549 a no-op. `{ 'tools/list': { ttlMs: 60_000 } }`
   * is the common case: a `private` cache belongs to the caller that filled it,
   * so the round trip is saved without crossing an authorization boundary.
   *
   * ⚠️ **`cacheScope: 'public'` is a security decision, not a performance one.**
   * The spec is explicit: "the Result from an authenticated `tools/list` call
   * with a `"public"` cacheScope may be cached by a client and may be shared
   * outside of the initial request's authorization context (i.e. different access
   * tokens can leverage the same cache)." mcp-nest filters `tools/list` per
   * caller (`@ToolScopes()` / `@ToolRoles()` / `allowUnauthenticatedAccess`),
   * so a `public` hint there can hand one principal's visible tool set to
   * another. The same reasoning applies to any `resources/*` result whose
   * contents depend on who asked. Mark a result `public` only when it is
   * genuinely identical for every caller, authenticated or not — the strategy
   * logs a warning at startup if you mark `tools/list` public while per-tool
   * authorization is in play.
   *
   * Invalid values (a negative or non-integer `ttlMs`, an unknown `cacheScope`)
   * throw a `RangeError` when the server is constructed.
   *
   * @default undefined (`ttlMs: 0`, `cacheScope: 'private'` — nothing is cached)
   */
  cacheHints?: McpCacheHints;
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
