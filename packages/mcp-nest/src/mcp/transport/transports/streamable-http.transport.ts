import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'crypto';
import {
  NodeStreamableHTTPServerTransport,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import {
  classifyInboundRequest,
  createMcpHandler,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  McpServer,
  validateHostHeader,
  validateOriginHeader,
  type McpHttpHandler as SdkMcpHttpHandler,
  type PerRequestResponseMode,
} from '@modelcontextprotocol/server';
import { HttpAdapterFactory } from '../../adapters/http-adapter.factory';
import {
  HttpRequest,
  HttpResponse,
} from '../../interfaces/http-adapter.interface';
import { McpTransport, McpTransportContext } from '../mcp-transport.interface';
import { MCP_RESOURCE_METADATA_URL } from '../mcp-transport.constants';
import type { McpHttpHandler } from '../mcp-http-handler';
import { readJsonBody } from './read-body';
import { describeRequirement } from '../../services/tool-authorization.service';

/**
 * How this endpoint answers the two protocol eras.
 *
 * - `dual` (default) — serve both. Each POST is classified with the SDK's own
 *   `isLegacyRequest` predicate: modern (`2026-07-28`) traffic goes to the
 *   stateless serving entry, 2025-era traffic to the classic wiring below
 *   (including `statefulMode` sessions). The spec explicitly allows this:
 *   "A dual-era server MAY serve both eras concurrently on the same endpoint
 *   or process."
 * - `modern-only` — answer 2025-era traffic with the unsupported-protocol-version
 *   error naming the revisions this endpoint serves. Legacy clients cannot fall
 *   forward, so that error is the only diagnostic they will see.
 * - `legacy-only` — the pre-`2026-07-28` behaviour, unchanged. Modern clients
 *   are rejected.
 */
export type McpProtocolPosture = 'dual' | 'modern-only' | 'legacy-only';

/**
 * `Origin` / `Host` allowlists for DNS-rebinding protection. `'localhost'` is
 * shorthand for the SDK's localhost-class allowlists (`localhost`, `127.0.0.1`,
 * `[::1]`).
 */
export interface McpTransportSecurityOptions {
  /**
   * Hostnames allowed in a request's `Origin` header, or `'localhost'`.
   *
   * Omit to skip the check entirely (the default — see
   * {@link StreamableHttpTransportOptions.security}). Entries are **hostnames
   * only**: no scheme, no port (the check is port-agnostic); bracket IPv6, e.g.
   * `'[::1]'`.
   */
  allowedOrigins?: string[] | 'localhost';
  /**
   * Hostnames allowed in a request's `Host` header, or `'localhost'`.
   *
   * Stricter than {@link allowedOrigins}: an *absent* `Host` header is rejected,
   * because a request that never names the host it thinks it reached cannot be
   * checked against the allowlist. Behind a reverse proxy the value a client
   * sent is usually rewritten, so allowlist the internal name the proxy
   * forwards, not the public one.
   */
  allowedHosts?: string[] | 'localhost';
}

/**
 * Step-up authorization: how a `tools/call` denied for lack of OAuth scope is
 * answered on the wire. See
 * {@link StreamableHttpTransportOptions.stepUpAuthorization}.
 */
export interface McpStepUpAuthorizationOptions {
  /**
   * The RFC 9728 protected-resource-metadata URL to advertise in the challenge's
   * `resource_metadata` parameter — the pointer a client follows to discover which
   * authorization server can issue the missing scopes.
   *
   * Usually unnecessary: `McpAuthJwtGuard` already publishes the URL it derives
   * from the module's `serverUrl` onto the request ({@link MCP_RESOURCE_METADATA_URL}),
   * and that is used when this is unset. Set it when authentication is something
   * else — an external authorization server, a gateway, your own guard.
   *
   * When neither is available the challenge goes out without `resource_metadata`:
   * `error` and `scope` are the parameters step-up actually turns on, and a
   * guessed metadata URL would only send clients to a 404.
   */
  resourceMetadataUrl?: string;
}

/** Per-request carrier for the Node request, so the SDK factory can recover it. */
const requestStore = new AsyncLocalStorage<{ nodeRequest: unknown }>();

export interface StreamableHttpTransportOptions {
  /**
   * Path of the transport's **self-mounted** route.
   *
   * This ONLY applies when the transport self-mounts (no controller owns the
   * route). A self-mounted route is registered directly on the HTTP adapter,
   * OUTSIDE Nest's routing pipeline — so it does not pick up
   * `app.setGlobalPrefix(...)`, URI versioning, guards, or interceptors. Use
   * `endpoint` for a trivial path change on a no-auth server.
   *
   * When you bring your own controller, the path comes from your
   * `@Controller(...)` decorator (and global prefix / versioning apply normally)
   * — `endpoint` is ignored. The transport logs a warning if you set it anyway.
   *
   * @default '/mcp'
   */
  endpoint?: string;
  /**
   * Enable session management (a long-lived MCP server per session, identified
   * by the `mcp-session-id` header, with `GET`/`DELETE` support for SSE streams
   * and session teardown).
   *
   * Left off (the default), the transport is **stateless**: every request is
   * self-contained, a fresh server is created and torn down per request, and
   * `GET`/`DELETE` return `405`. Stateless is the simplest mode and the right
   * default for most servers; turn this on only when you need server-initiated
   * streaming/notifications tied to a session.
   *
   * @default false (stateless)
   */
  statefulMode?: boolean;
  /**
   * Return a single JSON response instead of opening an SSE stream.
   *
   * When unset, this **follows the session mode**: `true` in stateless mode (so
   * a plain POST gets a JSON reply with no stream to manage) and `false` in
   * stateful mode (SSE, so server-initiated messages can flow). Set it
   * explicitly to override that pairing.
   *
   * @default `!statefulMode` (JSON when stateless, SSE when stateful)
   */
  enableJsonResponse?: boolean;
  /** Custom session id generator (stateful mode). Legacy era only — `2026-07-28` has no sessions. */
  sessionIdGenerator?: () => string;
  /**
   * Which protocol eras this endpoint serves. See {@link McpProtocolPosture}.
   *
   * @default 'dual'
   */
  protocol?: McpProtocolPosture;
  /**
   * Response shaping for **modern-era** exchanges (the `2026-07-28` equivalent of
   * {@link enableJsonResponse}, which stays legacy-only):
   *
   * - `'auto'` (default) — a single JSON body, upgraded to an SSE stream only if
   *   the handler emits something before its result (progress, logging).
   * - `'sse'` — always stream.
   * - `'json'` — never stream; mid-call progress/log notifications are dropped.
   *
   * @default 'auto'
   */
  responseMode?: PerRequestResponseMode;
  /**
   * `Origin` / `Host` header validation, for DNS-rebinding protection.
   *
   * **Off by default**, and deliberately so. The spec's MUST is narrow — a server
   * must answer `403` when `Origin` is *present and invalid*; an absent `Origin`
   * (every non-browser client) is not a violation — but an allowlist can only be
   * correct if it names the hostnames *this* deployment answers on. Defaulting to
   * a localhost allowlist would 403 every browser-originated request to a server
   * behind a proxy or on a real domain, and defaulting to "allow everything"
   * would be validation in name only. So: configure it and it is enforced,
   * omit it and it is skipped.
   *
   * Turn it on for any server that a browser can reach — that is the only threat
   * model this defends against. Rejections are answered `403` with a well-formed
   * JSON-RPC error body and no meaningful `id`, on `POST`, `GET` and `DELETE`
   * alike, before the body is read or an era is chosen.
   *
   * ```ts
   * // A locally-launched server: only browser pages served from localhost may talk to it.
   * new StreamableHttpTransport({ security: { allowedOrigins: 'localhost' } })
   * // A deployed server, both checks pinned to the public hostname.
   * new StreamableHttpTransport({
   *   security: { allowedOrigins: ['app.example.com'], allowedHosts: ['mcp.example.com'] },
   * })
   * ```
   *
   * @default undefined (no validation)
   */
  security?: McpTransportSecurityOptions;
  /**
   * Answer a scope-deficient `tools/call` with `403` + a
   * `WWW-Authenticate: Bearer error="insufficient_scope"` challenge, so a client
   * can run **step-up authorization** and come back with the scopes the tool
   * needs.
   *
   * Without this, a `@ToolScopes()` denial travels as a JSON-RPC error inside an
   * HTTP `200`. That is a working denial but a dead end: `WWW-Authenticate` is an
   * HTTP-status-bound mechanism, so a conforming client never learns *which*
   * scopes to request and step-up can never trigger. The spec asks for the
   * status-coded form:
   *
   * > If the request lacks the necessary scope, the server SHOULD respond with:
   * > `HTTP 403 Forbidden` … `WWW-Authenticate` header with the `Bearer` scheme
   * > and additional parameters: `error="insufficient_scope"`,
   * > `scope="required_scope1 required_scope2"`, `resource_metadata="…"`.
   *
   * **Off by default**, because the text is a SHOULD and turning it on changes
   * what every *existing* client sees for a denial — a transport-level `403`
   * instead of a tool-level JSON-RPC error — which older clients (and any code
   * asserting on the JSON-RPC error) do not expect. Opt in when your clients can
   * act on the challenge.
   *
   * What it does and does not cover:
   * - Era-independent: the check reads the parsed body before the era is chosen,
   *   so it applies to `2026-07-28` and 2025-era traffic alike. That is also the
   *   only place it *can* live on the modern era, where the SDK's own handler owns
   *   response writing once dispatch starts.
   * - Only a **scope** shortfall. `@ToolRoles()` failures are not scope failures —
   *   there is no scope to name in the challenge and no authorization request that
   *   would fix one — so they keep the JSON-RPC error. So does an unauthenticated
   *   caller (a 401 case) and an unknown tool (which must still get its `-32602`).
   * - Needs a resolved `req.user`, i.e. an authentication guard on the route.
   *   A **self-mounted** route bypasses the Nest pipeline entirely, so there is no
   *   user there and nothing changes; use an `McpHttpControllerFor` controller with
   *   `@UseGuards(...)` (`httpHandlers`) for an authenticated server.
   * - The `403` body is a well-formed JSON-RPC error carrying the request's own
   *   `id` and the same message the in-pipeline denial uses — an empty body makes
   *   a conforming client conclude the server is legacy and retry `initialize`.
   *
   * ```ts
   * new StreamableHttpTransport({ stepUpAuthorization: true })
   * // Authentication that is not @rekog/mcp-nest-auth: name the metadata URL.
   * new StreamableHttpTransport({
   *   stepUpAuthorization: {
   *     resourceMetadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
   *   },
   * })
   * ```
   *
   * @default false
   */
  stepUpAuthorization?: boolean | McpStepUpAuthorizationOptions;
  /**
   * Whether the transport mounts its own `POST`/`GET`/`DELETE` routes on the
   * Nest HTTP adapter.
   *
   * Leave it unset (the default) for **auto-detection**: the transport
   * self-mounts UNLESS something has read {@link httpHandlers} — which happens
   * exactly when you wire a bring-your-own `@Controller` (e.g. via
   * `{ provide: MCP_HTTP_HANDLER, useValue: transport.httpHandlers }`). So
   * providing a controller automatically suppresses self-mounting; doing
   * nothing keeps the zero-config self-mount. This read happens at module
   * definition time, before the transport starts, so the timing is reliable.
   *
   * Set it explicitly to override the heuristic:
   * - `true`: always self-mount (bypasses the Nest pipeline — no guards).
   * - `false`: never self-mount (you own the route via a controller).
   *
   * @default undefined (auto: self-mount unless `httpHandlers` was accessed)
   */
  mount?: boolean;
}

/**
 * Streamable-HTTP transport. Mounts `POST`/`GET`/`DELETE` on the Nest HTTP server
 * and delegates to the MCP SDK `StreamableHTTPServerTransport`. Supports both the
 * stateless (one server per request) and stateful (session-managed) modes.
 */
export class StreamableHttpTransport implements McpTransport {
  readonly kind = 'streamable-http' as const;

  private readonly endpoint: string;
  private readonly statefulMode: boolean;
  private readonly enableJsonResponse: boolean;
  private readonly sessionIdGenerator: () => string;
  /** Whether `endpoint` was set explicitly (vs defaulted) — for the ignored-option warning. */
  private readonly endpointExplicit: boolean;
  /** Explicit `mount` override; `undefined` means auto-detect. */
  private readonly mountOption?: boolean;
  /** Set the first time {@link httpHandlers} is read — implies a BYO controller. */
  private handlersClaimed = false;

  private readonly transports: Record<
    string,
    NodeStreamableHTTPServerTransport
  > = {};
  private readonly servers: Record<string, McpServer> = {};
  private ctx?: McpTransportContext;

  private readonly posture: McpProtocolPosture;
  private readonly responseMode: PerRequestResponseMode;
  /** Resolved allowlists; `undefined` means "don't check this header". */
  private readonly allowedOrigins?: string[];
  private readonly allowedHosts?: string[];
  /** Resolved `stepUpAuthorization`; `undefined` means the feature is off. */
  private readonly stepUp?: McpStepUpAuthorizationOptions;
  /** The SDK serving entry for `2026-07-28` traffic; absent when `legacy-only`. */
  private modernHandler?: SdkMcpHttpHandler;
  /** `toNodeHandler`-wrapped router — owns web↔Node conversion and SSE backpressure. */
  private modernNodeHandler?: (
    req: any,
    res: any,
    parsedBody?: unknown,
  ) => Promise<void>;
  /**
   * Maps the web `Request` the SDK serves to the Node request it came from.
   * `McpRequestContext.requestInfo` is object-identical to what we hand
   * `fetch()`, so this recovers the Express/Fastify request — which is what
   * carries `req.user` from NestJS guards and what `@RawRequest()` exposes.
   */
  private readonly nodeRequestFor = new WeakMap<object, unknown>();

  constructor(options: StreamableHttpTransportOptions = {}) {
    this.endpoint = ensureLeadingSlash(options.endpoint ?? 'mcp');
    this.endpointExplicit = options.endpoint !== undefined;
    this.statefulMode = options.statefulMode ?? false;
    // Default follows the session mode: JSON in stateless, SSE in stateful.
    this.enableJsonResponse = options.enableJsonResponse ?? !this.statefulMode;
    this.sessionIdGenerator =
      options.sessionIdGenerator ?? (() => randomUUID());
    this.mountOption = options.mount;
    this.posture = options.protocol ?? 'dual';
    this.responseMode = options.responseMode ?? 'auto';
    this.allowedOrigins = resolveAllowlist(
      options.security?.allowedOrigins,
      localhostAllowedOrigins,
    );
    this.allowedHosts = resolveAllowlist(
      options.security?.allowedHosts,
      localhostAllowedHostnames,
    );
    // `false`/absent ⇒ undefined ⇒ the pre-dispatch check is never even reached.
    this.stepUp =
      options.stepUpAuthorization === true
        ? {}
        : options.stepUpAuthorization || undefined;
  }

  /**
   * Build the `2026-07-28` serving entry.
   *
   * `legacy: 'reject'` because this transport keeps its own 2025-era leg: the
   * entry's built-in stateless fallback cannot do sessions (`statefulMode`) and
   * ignores `enableJsonResponse`, so routing in front of it with
   * `isLegacyRequest` is the only way to preserve existing behaviour exactly.
   */
  private buildModernHandler(ctx: McpTransportContext): void {
    if (this.posture === 'legacy-only') return;

    this.modernHandler = createMcpHandler(
      (reqCtx) => {
        const nodeRequest =
          (reqCtx.requestInfo
            ? this.nodeRequestFor.get(reqCtx.requestInfo)
            : undefined) ?? requestStore.getStore()?.nodeRequest;
        return ctx.createBoundServer(
          {
            transport: this.kind,
            // Every modern request is sessionless by construction — but unlike
            // the legacy stateless mode it can still stream progress and logs
            // back on its own response stream.
            stateless: true,
            era: 'modern',
          },
          nodeRequest,
        );
      },
      {
        legacy: 'reject',
        responseMode: this.responseMode,
        // The entry reports genuine faults AND routine protocol rejections
        // (e.g. a legacy client hitting a `modern-only` endpoint) through this
        // one callback, so it would be misleading to log all of it as an error.
        onerror: (error) =>
          ctx.logger.warn(`MCP modern-era handler: ${error.message}`),
      },
    );

    this.modernNodeHandler = toNodeHandler(
      {
        fetch: (request, options) => {
          const nodeRequest = requestStore.getStore()?.nodeRequest;
          if (nodeRequest !== undefined) {
            this.nodeRequestFor.set(request, nodeRequest);
          }
          return this.modernHandler!.fetch(request, options);
        },
      },
      { onerror: (error) => ctx.logger.error('MCP node adapter error', error) },
    );
  }

  /**
   * Reject the request when its `Origin` / `Host` header fails the configured
   * allowlist. Returns `true` when a `403` was written and the caller must stop.
   *
   * Runs on every verb, before the body is read and before the era is chosen: a
   * DNS-rebinding probe should never reach a handler. The `403` body is a
   * well-formed JSON-RPC error (matching the SDK's own
   * `originValidationResponse`) — an empty or unrecognized error body makes a
   * conforming client conclude the server is legacy and retry with `initialize`.
   *
   * The header helpers come from the SDK so the semantics are the ones the spec
   * text was written against: an absent `Origin` passes (non-browser clients
   * never send one, and DNS rebinding is a browser attack), while an unparseable
   * one — including the literal `null` origin of an opaque context — is denied.
   */
  private rejectedByHeaderValidation(
    req: HttpRequest,
    res: HttpResponse,
  ): boolean {
    const deny = (message: string): true => {
      res.status(403).json({
        jsonrpc: '2.0',
        error: { code: -32000, message },
        id: null,
      });
      return true;
    };

    if (this.allowedOrigins) {
      const result = validateOriginHeader(
        firstHeader(req, 'origin'),
        this.allowedOrigins,
      );
      if (!result.ok) return deny(result.message);
    }
    if (this.allowedHosts) {
      const result = validateHostHeader(
        firstHeader(req, 'host'),
        this.allowedHosts,
      );
      if (!result.ok) return deny(result.message);
    }
    return false;
  }

  /**
   * Answer a scope-deficient `tools/call` with the spec's step-up challenge, and
   * report whether it did (in which case the caller must stop).
   *
   * **Why this runs pre-dispatch.** The tool-level scope decision naturally lives
   * inside the JSON-RPC pipeline — but by then the HTTP status is settled: the
   * 2025-era SDK transport has already committed to `200`, and on the modern era
   * `createMcpHandler` owns response writing outright, so once it begins there is
   * no status left to change. `handlePost` already has the parsed body *and*, for
   * a BYO-controller setup, a `req.user` populated by the Nest guard — everything
   * the decision needs, at the last moment it can still choose a status. So the
   * transport asks the strategy the question up front
   * ({@link McpTransportContext.toolCallScopeDeficiency}, which reads the same
   * `ToolAuthorizationService` the pipeline enforces with) and, on a shortfall,
   * writes the `403` itself before the SDK ever sees the request.
   *
   * Reading the body rather than the `Mcp-Method`/`Mcp-Name` headers keeps this
   * era-independent: 2025-era requests carry no such headers, and where they do
   * exist the SDK cross-checks them against the body anyway (SEP-2243), so the
   * body is the authoritative statement of what is being called.
   *
   * Batches are deliberately left alone. A `403` fails the *whole* HTTP request,
   * which would take down every sibling call in a legacy batch — including
   * authorized ones — and a status code cannot say "the third element needs
   * scopes". Those keep the in-pipeline JSON-RPC denial, per element. (The modern
   * era has no batching at all.)
   */
  private rejectedByInsufficientScope(
    req: HttpRequest,
    res: HttpResponse,
    body: unknown,
  ): boolean {
    if (!this.stepUp || !this.ctx) return false;

    const call = body as
      | { method?: unknown; id?: unknown; params?: { name?: unknown } }
      | null
      | undefined;
    if (!call || typeof call !== 'object' || Array.isArray(call)) return false;
    if (call.method !== 'tools/call') return false;
    const toolName = call.params?.name;
    if (typeof toolName !== 'string') return false;

    const deficiency = this.ctx.toolCallScopeDeficiency(toolName, req.raw);
    if (!deficiency) return false;

    // Same wording the in-pipeline denial uses, so the only difference a client
    // sees between the two modes is the status code and the challenge header.
    const message = describeRequirement(
      toolName,
      'scopes',
      deficiency.requiredScopes,
      deficiency.match,
    );
    res.setHeader?.(
      'WWW-Authenticate',
      buildInsufficientScopeChallenge(
        deficiency.requiredScopes,
        this.stepUp.resourceMetadataUrl ??
          resourceMetadataUrlFromRequest(req.raw),
        message,
      ),
    );
    res.status(403).json({
      jsonrpc: '2.0',
      // The real request id, unlike the header-validation 403 — the body was
      // parsed, so the client can correlate the failure with its own call.
      id: call.id ?? null,
      error: { code: -32600, message },
    });
    return true;
  }

  /**
   * The HTTP verb handlers, for bring-your-own-controller setups. Provide this
   * under `MCP_HTTP_HANDLER` and delegate to it from a `@Controller` (see
   * {@link StreamableHttpController}). The returned functions are bound to this
   * transport and read their context lazily, so it is safe to grab this getter
   * at module-construction time — before `start()` has run.
   *
   * Reading this getter also marks the route as claimed, so the transport
   * auto-disables its own self-mount (unless `mount` was set explicitly). That
   * is how `{ provide: MCP_HTTP_HANDLER, useValue: transport.httpHandlers }`
   * suppresses self-mounting without any extra flag.
   */
  get httpHandlers(): McpHttpHandler {
    this.handlersClaimed = true;
    return {
      handlePost: (req: unknown, res: unknown) => this.handlePost(req, res),
      handleGet: (req: unknown, res: unknown) => this.handleGet(req, res),
      handleDelete: (req: unknown, res: unknown) => this.handleDelete(req, res),
    };
  }

  start(ctx: McpTransportContext): void {
    // The context (server factory, request-handler binding, logger) is always
    // needed — the handlers read it lazily whether we self-mount or a user
    // controller calls them.
    this.ctx = ctx;
    this.buildModernHandler(ctx);

    // Auto-detect: self-mount unless a controller claimed the route by reading
    // `httpHandlers`. An explicit `mount` option overrides the heuristic.
    const shouldMount = this.mountOption ?? !this.handlersClaimed;

    if (!shouldMount) {
      // The path now comes from the user's @Controller(...), so a self-mount
      // `endpoint` would be silently ignored. Don't let that pass quietly.
      if (this.endpointExplicit) {
        ctx.logger.warn(
          `StreamableHttpTransport: \`endpoint: '${this.endpoint}'\` is ignored because a controller owns the route. Set the path on your @Controller(...) decorator instead (it also picks up global prefix and versioning).`,
        );
      }
      ctx.logger.log(
        `MCP streamable-http transport ready (${this.statefulMode ? 'stateful' : 'stateless'}, self-mount disabled — a controller owns the route)`,
      );
      return;
    }

    if (!ctx.httpAdapter) {
      throw new Error(
        'StreamableHttpTransport requires an HTTP adapter to self-mount. Pass it via new McpStrategy({ httpAdapter }) or strategy.setHttpAdapter(app.getHttpAdapter()) — or mount your own controller (provide MCP_HTTP_HANDLER with transport.httpHandlers).',
      );
    }
    const adapter = ctx.httpAdapter as unknown as {
      post(path: string, handler: (req: any, res: any) => unknown): unknown;
      get(path: string, handler: (req: any, res: any) => unknown): unknown;
      delete(path: string, handler: (req: any, res: any) => unknown): unknown;
    };

    adapter.post(this.endpoint, (req, res) => this.handlePost(req, res));
    adapter.get(this.endpoint, (req, res) => this.handleGet(req, res));
    adapter.delete(this.endpoint, (req, res) => this.handleDelete(req, res));

    ctx.logger.log(
      `MCP streamable-http transport mounted at ${this.endpoint} (${this.statefulMode ? 'stateful' : 'stateless'})`,
    );
  }

  async close(): Promise<void> {
    // Abort the modern leg FIRST: `subscriptions/listen` streams are long-lived
    // by design, and leaving them open would stall shutdown.
    await this.modernHandler?.close();
    this.modernHandler = undefined;
    this.modernNodeHandler = undefined;
    for (const sessionId of Object.keys(this.transports)) {
      await this.cleanupSession(sessionId);
    }
  }

  /**
   * Publish a list-changed event to every open `subscriptions/listen` stream
   * that opted into it. The SDK owns the wire semantics (filtering, the
   * `io.modelcontextprotocol/subscriptionId` tag); we only source the event.
   */
  notifyListChanged(kind: 'tools' | 'resources' | 'prompts'): void {
    const notifier = this.modernHandler?.notify;
    if (!notifier) return;
    if (kind === 'tools') notifier.toolsChanged();
    else if (kind === 'resources') notifier.resourcesChanged();
    else notifier.promptsChanged();
  }

  private async handlePost(req: any, res: any): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedReq = adapter.adaptRequest(req);
    const adaptedRes = adapter.adaptResponse(res);
    if (this.rejectedByHeaderValidation(adaptedReq, adaptedRes)) return;
    const body = await readJsonBody(adaptedReq);
    // Before the era is chosen and before the SDK owns the response: the only
    // point at which a tool-level scope decision can still pick an HTTP status.
    if (this.rejectedByInsufficientScope(adaptedReq, adaptedRes, body)) return;

    try {
      if (this.servedByModernEra(adaptedReq.raw, body)) {
        await this.handleModern(adaptedReq.raw, adaptedRes.raw, body);
        return;
      }
      if (this.statefulMode) {
        await this.handleStateful(adaptedReq, adaptedRes, body);
      } else {
        await this.handleStateless(adaptedReq, adaptedRes, body);
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

  /**
   * Whether this POST belongs to the `2026-07-28` leg.
   *
   * Classification uses the SDK's own `classifyInboundRequest` — the very
   * function the serving entry runs to make the same decision — so our routing
   * can never disagree with it. Anything it does NOT call legacy (including its
   * validation-ladder rejections, such as a malformed envelope or an
   * unsupported version claim) MUST go to the modern handler: those error
   * answers belong to it.
   *
   * This takes the already-parsed body and a few headers rather than a web
   * `Request`, so the hot path allocates nothing: `toNodeHandler` builds the
   * one `Request` the modern leg actually serves.
   */
  private servedByModernEra(nodeRequest: any, body: unknown): boolean {
    if (!this.modernNodeHandler) return false;
    if (this.posture === 'modern-only') return true;
    const headers = (nodeRequest?.headers ?? {}) as Record<string, unknown>;
    const header = (name: string): string | undefined => {
      const value = headers[name];
      return typeof value === 'string' ? value : undefined;
    };
    const outcome = classifyInboundRequest({
      httpMethod: (nodeRequest?.method as string) ?? 'POST',
      protocolVersionHeader: header('mcp-protocol-version'),
      mcpMethodHeader: header('mcp-method'),
      mcpNameHeader: header('mcp-name'),
      body,
    });
    return outcome.kind !== 'legacy';
  }

  private async handleModern(
    nodeRequest: unknown,
    nodeResponse: unknown,
    body: unknown,
  ): Promise<void> {
    await requestStore.run({ nodeRequest }, () =>
      this.modernNodeHandler!(nodeRequest, nodeResponse, body),
    );
  }

  private async handleStateless(
    req: ReturnType<
      ReturnType<typeof HttpAdapterFactory.getAdapter>['adaptRequest']
    >,
    res: HttpResponse,
    body: unknown,
  ): Promise<void> {
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: this.enableJsonResponse,
    });
    const server = this.ctx!.createServer();
    await server.connect(transport);
    this.ctx!.bindRequestHandlers(
      server,
      { transport: this.kind, stateless: true, era: 'legacy' },
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
      const transport = new NodeStreamableHTTPServerTransport({
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
        { transport: this.kind, stateless: false, era: 'legacy' },
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
        { transport: this.kind, stateless: false, sessionId, era: 'legacy' },
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
    if (this.rejectedByHeaderValidation(adaptedReq, adaptedRes)) return;

    if (!this.statefulMode) {
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
    if (this.rejectedByHeaderValidation(adaptedReq, adaptedRes)) return;

    if (!this.statefulMode) {
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

/**
 * Turn a `string[] | 'localhost'` allowlist option into the array the SDK
 * validators take. `undefined` stays `undefined` — the signal for "don't check".
 */
function resolveAllowlist(
  option: string[] | 'localhost' | undefined,
  localhost: () => string[],
): string[] | undefined {
  if (option === undefined) return undefined;
  return option === 'localhost' ? localhost() : option;
}

/**
 * The `WWW-Authenticate` value for a `403` step-up challenge, per the MCP
 * authorization spec (RFC 6750 §3 / RFC 9728 for the parameters):
 *
 * `Bearer error="insufficient_scope", error_description="…", scope="a b", resource_metadata="…"`
 *
 * `scope` is space-delimited (OAuth 2.0's own encoding, so the client can hand it
 * straight to `/authorize`). Parameter values are quoted-string, so `"` and `\`
 * are escaped — a scope name is client-influenced input in the general case and an
 * unescaped quote would let it forge extra parameters.
 */
function buildInsufficientScopeChallenge(
  requiredScopes: string[],
  resourceMetadataUrl: string | undefined,
  description: string,
): string {
  const params = [
    `error="insufficient_scope"`,
    `error_description="${quote(description)}"`,
    `scope="${quote(requiredScopes.join(' '))}"`,
  ];
  if (resourceMetadataUrl) {
    params.push(`resource_metadata="${quote(resourceMetadataUrl)}"`);
  }
  return `Bearer ${params.join(', ')}`;
}

/** Escape a `WWW-Authenticate` quoted-string value. */
function quote(value: string): string {
  return value.replace(/[\\"]/g, '\\$&');
}

/**
 * The protected-resource-metadata URL an authentication layer published on this
 * request (see {@link MCP_RESOURCE_METADATA_URL}). `undefined` when nothing did —
 * core has no way to derive one, so the challenge then omits `resource_metadata`
 * rather than pointing clients at a URL that may not exist.
 */
function resourceMetadataUrlFromRequest(raw: unknown): string | undefined {
  const value = (raw as Record<symbol, unknown> | undefined)?.[
    MCP_RESOURCE_METADATA_URL
  ];
  return typeof value === 'string' ? value : undefined;
}

/** Read one header value; Node exposes repeated headers as an array. */
function firstHeader(req: HttpRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function ensureLeadingSlash(endpoint: string): string {
  const trimmed = endpoint.trim();
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
