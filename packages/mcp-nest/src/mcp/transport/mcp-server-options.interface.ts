import {
  Icon,
  ServerCapabilities,
  McpServer,
  type ServerOptions,
} from '@modelcontextprotocol/server';
import { HttpServer } from '@nestjs/common';
import { McpTransport } from './mcp-transport.interface';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

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
 * The `requestState` integrity hook for Multi Round-Trip Requests (MRTR,
 * protocol revision `2026-07-28`). Derived from the SDK's own option so the
 * hook signature cannot drift. See {@link McpServerOptions.requestState}.
 */
export type McpRequestStateOptions = NonNullable<ServerOptions['requestState']>;

/**
 * Multi-round-trip serving knobs (`maxRounds`, `roundTimeoutMs`, `legacyShim`).
 * Derived from the SDK's own option. See {@link McpServerOptions.inputRequired}.
 */
export type McpInputRequiredOptions = NonNullable<
  ServerOptions['inputRequired']
>;

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
  /**
   * Integrity hook for the Multi Round-Trip Request `requestState` (MRTR,
   * `2026-07-28`). `verify` runs on every round whose echoed `requestState` is a
   * string, **before** the handler, on both eras (the legacy shim's in-process
   * rounds included). Throw to refuse the request: the client gets a wire-level
   * `-32602` whose message is frozen to `"Invalid or expired requestState"`.
   * The value `verify` resolves with is what
   * {@link McpContext.getRequestState} returns to the handler.
   *
   * ⚠️ **`requestState` is attacker-controlled input on re-entry.** The spec
   * requires integrity protection (HMAC or AEAD) whenever the state influences
   * authorization, resource access or business logic, and rejection of state
   * that fails verification. The SDK applies **no** protection by default. The
   * recommended setup is the SDK's HMAC codec, re-exported by this package:
   *
   * ```ts
   * const codec = createRequestStateCodec<MyState>({ key: process.env.MRTR_KEY! });
   * new McpStrategy({ ..., requestState: { verify: codec.verify } });
   * // in a handler: inputRequired({ requestState: await codec.mint(state) })
   * // on re-entry:  ctx.getRequestState<MyState>()  // verified + decoded
   * ```
   *
   * Left unset, handlers read the raw wire string and must verify it themselves.
   *
   * @default undefined (no verification — `getRequestState()` returns the raw string)
   */
  requestState?: McpRequestStateOptions;
  /**
   * Multi-round-trip serving knobs. On `2026-07-28` requests the client fulfils
   * `input_required` returns itself. On 2025-era connections the SDK's legacy
   * shim fulfils them server-side (real server→client requests, then handler
   * re-entry), so a handler is written once and serves both eras.
   *
   * - `maxRounds` — handler re-entries per originating request before the shim
   *   gives up (`isError` result for `tools/call`; JSON-RPC error for
   *   `prompts/get` and `resources/read`). Default `8`.
   * - `roundTimeoutMs` — per-leg timeout for the shim's server→client requests.
   *   Human-paced; default `600_000`.
   * - `legacyShim` — `false` makes an `input_required` return on a 2025-era
   *   request fail loudly instead. Default `true`.
   */
  inputRequired?: McpInputRequiredOptions;
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
   * Where per-tool authorization reads the caller from.
   *
   * The function receives the raw transport request and returns the principal
   * that `@ToolScopes()`, `@ToolRoles()` and `allowUnauthenticatedAccess`
   * judge:
   *
   * - Scopes are read off `scope` (space-delimited) or `scopes` (array), roles
   *   off `roles` — see {@link AuthenticatedUser}.
   * - The same principal drives `tools/list` filtering, the `tools/call` denial
   *   and the step-up challenge, so the three cannot disagree.
   * - `undefined` means "no principal", exactly as a missing `req.user` does.
   * - Not called on STDIO, where there is no request.
   *
   * For authentication that keeps its claims somewhere other than `req.user`,
   * so they need not be copied there:
   *
   * ```ts
   * // express-jwt ≥ 7 writes the claims to `req.auth`
   * resolveUser: (req) => (req as { auth?: AuthenticatedUser }).auth
   *
   * // express-oauth2-jwt-bearer (Auth0) nests them one level deeper
   * resolveUser: (req) =>
   *   (req as { auth?: { payload?: AuthenticatedUser } }).auth?.payload
   * ```
   *
   * Left unset, the strategy reads `rawRequest.user`.
   *
   * @default undefined (`rawRequest.user`)
   */
  resolveUser?: (rawRequest: unknown) => AuthenticatedUser | undefined;

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
