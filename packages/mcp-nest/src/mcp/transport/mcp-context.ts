import { Logger } from '@nestjs/common';
import { BaseRpcContext } from '@nestjs/microservices';
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  ClientCapabilities,
  Implementation,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
  Progress,
  ServerContext,
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
  private createRelatedReportProgress(): (
    progress: Progress,
  ) => Promise<void> {
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
