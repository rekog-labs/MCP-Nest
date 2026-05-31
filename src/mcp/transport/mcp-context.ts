import { Logger } from '@nestjs/common';
import { BaseRpcContext } from '@nestjs/microservices';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { Context, McpRequest, SerializableValue } from '../interfaces';

export type McpTransportKind = 'stdio' | 'streamable-http' | 'sse';

export interface McpSessionInfo {
  /** The MCP session id, when the transport is session-aware. */
  sessionId?: string;
  /** Which transport delivered this request. */
  transport: McpTransportKind;
  /**
   * `true` only for the per-request streamable-HTTP stateless mode, where the
   * server cannot push notifications/progress back to the client. stdio, SSE
   * and stateful streamable-HTTP are all session-aware (`false`).
   */
  stateless: boolean;
}

type McpContextArgs = [
  mcpServer: McpServer,
  mcpRequest: McpRequest,
  session: McpSessionInfo,
  rawRequest: unknown,
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
    this.reportProgress = this.getSession().stateless
      ? this.createStatelessReportProgress()
      : this.createReportProgress();
    this.log = this.getSession().stateless
      ? this.createStatelessLog()
      : this.createLog();
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
