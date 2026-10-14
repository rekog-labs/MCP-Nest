import {
  Icon,
  ServerCapabilities,
  McpServer,
  type ServerOptions,
} from '@modelcontextprotocol/server';
import { HttpServer } from '@nestjs/common';
import { McpTransport } from './mcp-transport.interface';
import type { AuthenticatedUser } from '../interfaces/authenticated-user.interface';
import type { McpProtocolEra, McpTransportKind } from './mcp-context';

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
/**
 * What a per-caller {@link McpServerOptions.instructions},
 * {@link McpServerOptions.title} or {@link McpServerOptions.description}
 * resolver is given.
 */
export interface McpInstructionsContext {
  /**
   * The raw Node `IncomingMessage` that caused the server to be created, or
   * `undefined` on STDIO. On Fastify this is `request.raw`, not the Fastify
   * request.
   */
  request: unknown;
  /**
   * The caller, read the same way per-tool authorization reads it
   * ({@link McpServerOptions.resolveUser}, else `request.user`). `undefined`
   * when there is no authenticated user, and always on STDIO.
   */
  user?: AuthenticatedUser;
  /** The protocol era of the request that created the server. */
  era: McpProtocolEra;
  /** The transport kind serving the request. */
  transport: McpTransportKind;
}

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
  /**
   * Human-readable display name (MCP `Implementation.title`).
   *
   * Pass a function to choose it per caller, e.g. a white-labelled product
   * name. It works exactly like {@link instructions}: synchronous, given an
   * {@link McpInstructionsContext}, run whenever an SDK server is created, and
   * failing soft (a resolver that throws or returns a non-string is logged and
   * the server goes out without a title).
   */
  title?: string | ((ctx: McpInstructionsContext) => string | undefined);
  /**
   * Short description of what this server does (MCP
   * `Implementation.description`). Accepts a per-caller function, like
   * {@link title}.
   */
  description?: string | ((ctx: McpInstructionsContext) => string | undefined);
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
   * so a `public` hint there can hand one user's visible tool set to
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
  /**
   * Server instructions, sent in the `initialize` result (2025 era) and the
   * `server/discover` result (`2026-07-28`).
   *
   * Pass a function to choose them per caller. It receives an
   * {@link McpInstructionsContext} and runs whenever an SDK server is created:
   * once per session on stateful 2025-era HTTP (the `initialize` request), once
   * per request on stateless and `2026-07-28` traffic, and once per connection
   * on STDIO (no request, no user).
   *
   * ```ts
   * instructions: ({ user, request }) =>
   *   user?.roles?.includes('admin')
   *     ? adminInstructions
   *     : (request as IncomingMessage | undefined)?.headers['x-experience'] === 'foo'
   *       ? fooInstructions
   *       : defaultInstructions
   * ```
   *
   * It must be **synchronous**, and it should be cheap: on `2026-07-28` traffic
   * it runs for every request, not only for `server/discover`.
   *
   * Fails soft. Instructions are guidance for the model, not access control, so
   * a resolver that throws, or that returns anything other than a string or
   * `undefined` (e.g. a promise), is logged and the server is sent with no
   * instructions. The request itself is still served.
   *
   * Instructions that vary per caller are user-specific data in the
   * `server/discover` result, so do not hint `server/discover` as
   * `cacheScope: 'public'` (see {@link cacheHints}); the strategy logs a
   * warning at startup if you do.
   */
  instructions?: string | ((ctx: McpInstructionsContext) => string | undefined);
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
   * Where per-tool authorization reads the user from.
   *
   * The function receives the raw transport request and returns the user
   * that `@ToolScopes()`, `@ToolRoles()` and `allowUnauthenticatedAccess`
   * judge:
   *
   * - Scopes are read off `scope` (space-delimited) or `scopes` (array), roles
   *   off `roles` or `user_data.roles` — see {@link AuthenticatedUser}.
   * - The same user drives `tools/list` filtering, the `tools/call` denial,
   *   the step-up challenge and {@link McpContext.getUser}, so they cannot
   *   disagree. It is resolved at most once per request and cached for it —
   *   as is the default `req.user` read.
   * - `undefined` means "no user", exactly as a missing `req.user` does.
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
   * It must be **synchronous**: an authorization decision cannot wait, so an
   * `async` resolver is a type error (that is what the `then?: never` is for) and
   * a thenable returned past the types is refused at runtime. Do the token work
   * in the middleware or guard that runs before the route, and read its result
   * here.
   *
   * It should also be cheap and free of side effects. It runs on a hot path, and
   * a resolver that answers differently for the same request would make the
   * challenge and the denial contradict each other.
   *
   * Fails closed: a resolver that throws, or that returns anything other than an
   * object or `undefined`, logs and counts as "no user". A tool is never
   * opened up by a broken resolver.
   *
   * **Fastify:** the argument is the raw Node `IncomingMessage`, not the Fastify
   * request, so a claim that an `onRequest` hook put on the Fastify request is not
   * visible here. Put it on `request.raw` instead. (The same limit applies to the
   * default `req.user` read.)
   *
   * Left unset, the strategy reads `rawRequest.user` — through the same cached,
   * fail-closed path, so a non-object left there is refused the same way.
   *
   * @default undefined (`rawRequest.user`)
   */
  resolveUser?: (
    rawRequest: unknown,
  ) => (AuthenticatedUser & { then?: never }) | undefined;

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
