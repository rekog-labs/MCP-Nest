import { Logger } from '@nestjs/common';
import { BaseRpcContext } from '@nestjs/microservices';
import {
  acceptedContent,
  BAGGAGE_META_KEY,
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  ClientCapabilities,
  Implementation,
  inputResponse,
  InputResponseView,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  Progress,
  ServerContext,
  StandardSchemaV1,
  TRACEPARENT_META_KEY,
  TRACESTATE_META_KEY,
} from '@modelcontextprotocol/server';
import { Context, McpRequest, SerializableValue } from '../interfaces';

export type McpTransportKind = 'stdio' | 'streamable-http';

/**
 * Which protocol revision family served this request.
 *
 * - `legacy` — 2025-era: the client opened with an `initialize` handshake, and
 *   state (capabilities, protocol version, identity) lives on the connection.
 * - `modern` — protocol revision `2026-07-28` and later: there is no handshake;
 *   every request carries its own `_meta` envelope and is served statelessly.
 *
 * A dual-era server answers both on the same endpoint, so this is a *per-request*
 * fact, not a server-wide one.
 */
export type McpProtocolEra = 'legacy' | 'modern';

/**
 * W3C trace-context values a client attached to a request (SEP-414).
 *
 * `traceparent`, `tracestate` and `baggage` are *reserved* `_meta` keys — the
 * only sanctioned exception to the "`_meta` keys are reverse-DNS prefixed" rule
 * — so they are read verbatim, not under an `io.modelcontextprotocol/` prefix.
 * Each field is absent when the client did not send it.
 *
 * Surfaced as sent, not validated: the spec says the values MUST follow the W3C
 * formats, but a value that does not is still a client bug, not something to
 * silently drop. Hand them to your tracer's own propagator, which will reject
 * malformed input properly.
 */
export interface McpTraceContext {
  /** W3C `traceparent`, e.g. `00-4bf92f...4736-00f067aa0ba902b7-01`. */
  traceparent?: string;
  /** W3C `tracestate`, e.g. `vendor1=value1,vendor2=value2`. */
  tracestate?: string;
  /** W3C Baggage, e.g. `userId=alice,serverRegion=us-east-1`. */
  baggage?: string;
}

export interface McpSessionInfo {
  /**
   * The MCP session id.
   *
   * Only ever set on the `legacy` era with a session-aware transport. Protocol
   * sessions and the `Mcp-Session-Id` header were removed in `2026-07-28`, so
   * this is always `undefined` for `modern` requests.
   */
  sessionId?: string;
  /** Which transport delivered this request. */
  transport: McpTransportKind;
  /**
   * `true` when no session backs this request.
   *
   * NOTE: this no longer implies "cannot talk back to the client". Every
   * `modern`-era request is sessionless, yet progress and logging still work —
   * they flow on the response stream of the request they relate to. Check
   * {@link era} rather than this flag when you care about capability.
   */
  stateless: boolean;
  /**
   * The protocol era serving this request. Absent only when a custom transport
   * did not declare one, in which case treat it as `legacy`.
   */
  era?: McpProtocolEra;
}

/** The session facts a transport supplies; the strategy fills in the rest. */
export type McpSessionSeed = Pick<
  McpSessionInfo,
  'transport' | 'stateless' | 'sessionId' | 'era'
>;

type McpContextArgs = [
  mcpServer: McpServer,
  mcpRequest: McpRequest,
  session: McpSessionInfo,
  rawRequest: unknown,
  /**
   * The SDK's per-request handler context (2nd argument of `setRequestHandler`).
   * Absent when a context is built outside a live request.
   */
  sdkContext?: ServerContext,
];

/**
 * Execution context handed to every MCP capability handler via `@Ctx()`.
 *
 * Extends NestJS's {@link BaseRpcContext} so it is resolved as the RPC context
 * argument (the strategy invokes handlers as `handler(payload, mcpContext)`),
 * and implements the library's {@link Context} surface (`reportProgress`, `log`,
 * `mcpServer`, `mcpRequest`) so existing handler code keeps working.
 *
 * Additional accessors expose the session and the raw transport request.
 */
export class McpContext
  extends BaseRpcContext<McpContextArgs>
  implements Context
{
  public readonly reportProgress: (progress: Progress) => Promise<void>;
  public readonly log: Context['log'];

  constructor(
    args: McpContextArgs,
    private readonly logger?: Logger,
  ) {
    super(args);
    // On the modern era there is no connection to push down: server-initiated
    // messages must be *related* to the request being served, which is what the
    // SDK's per-request seam does. A connection-level `server.notification(...)`
    // is silently dropped there.
    //
    // The legacy era keeps its original behaviour byte-for-byte: session-aware
    // connections push over the connection, and the per-request stateless mode
    // has nowhere to send anything at all.
    if (this.isModern) {
      this.reportProgress = this.createRelatedReportProgress();
      this.log = this.createRelatedLog();
    } else if (this.getSession().stateless) {
      this.reportProgress = this.createStatelessReportProgress();
      this.log = this.createStatelessLog();
    } else {
      this.reportProgress = this.createReportProgress();
      this.log = this.createLog();
    }
  }

  private get isModern(): boolean {
    return this.getSession().era === 'modern';
  }

  /** The SDK's per-request handler context, when this context serves a live request. */
  private get sdkContext(): ServerContext | undefined {
    return this.args[4];
  }

  /** The underlying MCP SDK server instance. */
  get mcpServer(): McpServer {
    return this.args[0];
  }

  /** The parsed JSON-RPC request (tools/call, resources/read, prompts/get, ...). */
  get mcpRequest(): McpRequest {
    return this.args[1];
  }

  /** Session metadata for this request. */
  getSession(): McpSessionInfo {
    return this.args[2];
  }

  /** The raw transport request (Express/Fastify request for HTTP; `undefined` for stdio). */
  getRawRequest<T = unknown>(): T | undefined {
    return this.args[3] as T | undefined;
  }

  /**
   * The protocol revision this request declared.
   *
   * On the `modern` era this comes from the request's own `_meta` envelope. On
   * the `legacy` era it was negotiated once at `initialize` time and is not
   * carried per request, so this returns `undefined` there.
   */
  getProtocolVersion(): string | undefined {
    return this.sdkContext?.mcpReq.envelope?.[PROTOCOL_VERSION_META_KEY];
  }

  /**
   * The capabilities the calling client declared **for this request**.
   *
   * `2026-07-28` removed the `initialize` handshake, so capabilities travel with
   * every request and MUST NOT be inferred from earlier ones. Returns
   * `undefined` on the legacy era — read them off the connection instead.
   */
  getClientCapabilities(): ClientCapabilities | undefined {
    return this.sdkContext?.mcpReq.envelope?.[CLIENT_CAPABILITIES_META_KEY];
  }

  /**
   * The calling client's self-reported identity, when it sent one (the spec
   * makes `clientInfo` a SHOULD, not a MUST).
   *
   * Self-reported and unverified — do not make security decisions on it.
   */
  getClientInfo(): Implementation | undefined {
    return this.sdkContext?.mcpReq.envelope?.[CLIENT_INFO_META_KEY];
  }

  /**
   * The OpenTelemetry trace context the caller propagated, for stitching this
   * handler's spans into the client's trace.
   *
   * Unlike {@link getProtocolVersion} and friends these are ordinary request
   * `_meta` keys, not modern-envelope fields, so they work on **both** eras —
   * `2026-07-28` merely reserved the key names and pinned the value formats. In
   * practice only a client that knows about SEP-414 sends them, so expect an
   * empty object from 2025-era clients.
   *
   * Reachable from `@Tool`, `@Resource`/`@ResourceTemplate` and `@Prompt`
   * handlers — the requests that carry `params._meta`. The list operations
   * (`tools/list` and friends) take no per-request context in mcp-nest, so
   * nothing is available for them on either era.
   *
   * ```ts
   * const { traceparent, baggage } = context.getTraceContext();
   * ```
   */
  getTraceContext(): McpTraceContext {
    const meta = this.mcpRequest.params?._meta as
      | Record<string, unknown>
      | undefined;
    const read = (key: string): string | undefined => {
      const value = meta?.[key];
      return typeof value === 'string' ? value : undefined;
    };
    const trace: McpTraceContext = {};
    const traceparent = read(TRACEPARENT_META_KEY);
    const tracestate = read(TRACESTATE_META_KEY);
    const baggage = read(BAGGAGE_META_KEY);
    if (traceparent !== undefined) trace.traceparent = traceparent;
    if (tracestate !== undefined) trace.tracestate = tracestate;
    if (baggage !== undefined) trace.baggage = baggage;
    return trace;
  }

  // ---------------------------------------------------------------------------
  // Multi Round-Trip Requests (MRTR, protocol revision 2026-07-28)
  // ---------------------------------------------------------------------------

  /**
   * The input responses a retried request carried (MRTR).
   *
   * A handler that returned `inputRequired({ inputRequests: { key: … } })` reads
   * the client's answers here on re-entry, keyed by the identifiers it assigned.
   * Entries are the bare response objects (`ElicitResult`, `CreateMessageResult`,
   * `ListRootsResult`). `undefined` on a first round, or when the retry carried
   * no responses.
   *
   * Works on both eras: on `2026-07-28` the client echoes them on its retry; on
   * the legacy era the SDK's shim collects them from real server→client requests
   * and re-enters the handler with the same shape.
   *
   * The values arrive from the client and are **not validated** — treat them as
   * untrusted input. Prefer {@link getAcceptedContent} with a schema, or
   * {@link getInputResponse} for the discriminated view.
   */
  getInputResponses(): Record<string, unknown> | undefined {
    return this.sdkContext?.mcpReq.inputResponses;
  }

  /**
   * Keys of `inputResponses` entries the SDK dropped because they were not bare
   * response objects (for example the wrapped `{ method, result }` shape some
   * peers emit). Re-issue the corresponding input request instead of failing
   * hard — the spec says a server SHOULD ask again for missing information
   * rather than return an error. Empty when nothing was dropped.
   */
  getDroppedInputResponseKeys(): string[] {
    return this.sdkContext?.mcpReq.droppedInputResponseKeys ?? [];
  }

  /**
   * One entry of the retried request's input responses as a discriminated view:
   * `{ kind: 'missing' }`, `{ kind: 'elicit', action, content? }`,
   * `{ kind: 'sampling', result }` or `{ kind: 'roots', roots }`. Use it to tell a
   * declined or cancelled elicitation from a missing one.
   */
  getInputResponse(key: string): InputResponseView {
    return inputResponse(this.getInputResponses(), key);
  }

  /**
   * The accepted content of a form-mode elicitation response, or `undefined`
   * when the key is missing, the user declined or cancelled, or the response is
   * of another kind.
   *
   * Pass a Standard Schema (e.g. a Zod object) as the second argument to
   * validate the untrusted client value before it reaches your code — a value
   * that fails validation also reads as `undefined`, so both cases take the
   * same branch: ask again, or give up. Only synchronous schemas are supported.
   */
  getAcceptedContent<T extends Record<string, unknown> = Record<string, unknown>>(
    key: string,
  ): T | undefined;
  getAcceptedContent<S extends StandardSchemaV1>(
    key: string,
    schema: S,
  ): StandardSchemaV1.InferOutput<S> | undefined;
  getAcceptedContent(key: string, schema?: StandardSchemaV1): unknown {
    const responses = this.getInputResponses();
    return schema
      ? acceptedContent(responses, key, schema)
      : acceptedContent(responses, key);
  }

  /**
   * The multi-round-trip `requestState` for this round, or `undefined` on a
   * first round.
   *
   * With {@link McpServerOptions.requestState} configured (the recommended
   * setup — pass `createRequestStateCodec(...).verify`), this is the **verified
   * and decoded** payload the codec minted, and `T` is the type you minted.
   * Without it, this is the raw wire string exactly as the client echoed it.
   *
   * **SECURITY:** `requestState` round-trips through the client and is
   * attacker-controlled input on re-entry. The spec requires integrity
   * protection (HMAC or AEAD) whenever the state influences authorization,
   * resource access or business logic, and rejection of state that fails the
   * check. The type parameter is a compile-time cast only — it proves nothing
   * unless a verify hook backs it.
   */
  getRequestState<T = unknown>(): T | undefined {
    return this.sdkContext?.mcpReq.requestState<T>();
  }

  private get progressToken(): string | number | undefined {
    return this.mcpRequest.params?._meta?.progressToken;
  }

  private createReportProgress(): (progress: Progress) => Promise<void> {
    return async (progress: Progress) => {
      const progressToken = this.progressToken;
      if (progressToken === undefined) {
        return;
      }
      await this.mcpServer.server.notification({
        method: 'notifications/progress',
        params: { ...progress, progressToken } as Progress,
      });
    };
  }

  private createLog(): Context['log'] {
    const send = (
      level: 'debug' | 'info' | 'warning' | 'error',
      message: string,
      context?: SerializableValue,
    ) => {
      void this.mcpServer.server.sendLoggingMessage({
        level,
        data: { message, context },
      });
    };
    return {
      debug: (message, context) => send('debug', message, context),
      info: (message, context) => send('info', message, context),
      warn: (message, context) => send('warning', message, context),
      error: (message, context) => send('error', message, context),
    };
  }

  /**
   * Progress on the modern era: emitted as a message *related* to the request
   * being served, so it lands on that request's response stream (which the SDK
   * upgrades from a JSON body to SSE on the first related message).
   */
  private createRelatedReportProgress(): (progress: Progress) => Promise<void> {
    return async (progress: Progress) => {
      const progressToken = this.progressToken;
      if (progressToken === undefined) {
        return;
      }
      const sdk = this.sdkContext;
      if (!sdk) {
        this.logger?.warn(
          "No per-request context available: 'reportProgress' is not supported.",
        );
        return;
      }
      await sdk.mcpReq.notify({
        method: 'notifications/progress',
        params: { ...progress, progressToken } as Progress,
      });
    };
  }

  /**
   * Logging on the modern era. `logging/setLevel` is gone; the client opts in
   * per request via `io.modelcontextprotocol/logLevel` in `_meta`, and the SDK
   * enforces the spec's "MUST NOT emit `notifications/message` for a request
   * that did not include this field" rule for us.
   */
  private createRelatedLog(): Context['log'] {
    const send = (
      level: 'debug' | 'info' | 'warning' | 'error',
      message: string,
      context?: SerializableValue,
    ) => {
      const sdk = this.sdkContext;
      if (!sdk) {
        this.logger?.warn(
          'No per-request context available: server-side logging is not supported.',
        );
        return;
      }
      void sdk.mcpReq.log(level, { message, context });
    };
    return {
      debug: (message, context) => send('debug', message, context),
      info: (message, context) => send('info', message, context),
      warn: (message, context) => send('warning', message, context),
      error: (message, context) => send('error', message, context),
    };
  }

  private createStatelessReportProgress(): (
    progress: Progress,
  ) => Promise<void> {
    return () => {
      this.logger?.warn(
        "Stateless context: 'reportProgress' is not supported.",
      );
      return Promise.resolve();
    };
  }

  private createStatelessLog(): Context['log'] {
    const warn = () =>
      this.logger?.warn(
        'Stateless context: server-side logging is not supported.',
      );
    return {
      debug: () => warn(),
      info: () => warn(),
      warn: () => warn(),
      error: () => warn(),
    };
  }
}
