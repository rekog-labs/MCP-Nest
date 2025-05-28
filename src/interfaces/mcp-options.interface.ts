import { ServerCapabilities } from '@modelcontextprotocol/sdk/types.js';
import { CanActivate, Type } from '@nestjs/common';

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
  sseEndpoint?: string;
  messagesEndpoint?: string;
  mcpEndpoint?: string;
  /**
   * @deprecated Use `app.setGlobalPrefix()` instead.
   */
  globalApiPrefix?: string;
  guards?: Type<CanActivate>[];
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
}
