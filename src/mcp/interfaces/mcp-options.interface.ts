import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { CanActivate, ModuleMetadata, Type } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export enum McpTransportType {
  SSE = 'sse',
  STREAMABLE_HTTP = 'streamable-http',
  STDIO = 'stdio',
}

export interface McpOptions {
  // When and if, additional properties are introduced in ServerOptions or ServerInfo,
  // consider deprecating these fields in favor of using ServerOptions and ServerInfo directly.
  name: string;
  version: string;
  capabilities?: ServerCapabilities;
  instructions?: string;

  transport?: McpTransportType | McpTransportType[];
  serverMutator?: (server: McpServer) => McpServer;
  sseEndpoint?: string;
  messagesEndpoint?: string;
  mcpEndpoint?: string;
  /**
   * @deprecated Use `app.setGlobalPrefix()` for global api prefix. Use apiPrefix to attach a prefix to the handshake.
   */
  globalApiPrefix?: never;
  apiPrefix?: string;
  guards?: Type<CanActivate>[];
  /**
   * Allow unauthenticated sessions to connect and access @PublicTool() tools.
   *
   * When true (freemium mode):
   * - Unauthenticated requests are allowed through guards
   * - Can access tools marked with @PublicTool()
   * - Must authenticate to access protected tools (based on scopes/roles)
   *
   * When false or undefined (standard OAuth flow - default):
   * - Unauthenticated requests receive 401 response
   * - Triggers MCP OAuth authorization flow
   * - All tools require authentication
   *
   * @default false
   */
  allowUnauthenticatedAccess?: boolean;
  decorators?: ClassDecorator[];
  sse?: {
    pingEnabled?: boolean;
    pingIntervalMs?: number;
  };
  streamableHttp?: {
    enableJsonResponse?: boolean;
    sessionIdGenerator?: () => string;
    /**
     * @experimental: The current implementation does not fully comply with the MCP Specification.
     */
    statelessMode?: boolean;
  };
  /**
   * Configure logging for the MCP module.
   * - `false` to disable all MCP logging
   * - `{ level: LogLevel[] }` to specify which log levels to show
   * - `undefined` (default) to use standard NestJS logging
   */
  logging?:
    | false
    | {
        level: ('log' | 'error' | 'warn' | 'debug' | 'verbose')[];
      };
}

// Async variant omits transport since controllers are not auto-registered in forRootAsync
export type McpAsyncOptions = Omit<McpOptions, 'transport'>;

export interface McpOptionsFactory {
  createMcpOptions(): Promise<McpAsyncOptions> | McpAsyncOptions;
}

export interface McpModuleAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useExisting?: Type<McpOptionsFactory>;
  useClass?: Type<McpOptionsFactory>;
  useFactory?: (...args: any[]) => Promise<McpAsyncOptions> | McpAsyncOptions;
  inject?: any[];
  extraProviders?: any[]; // allow user to provide additional providers in async mode
}
