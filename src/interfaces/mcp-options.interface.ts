import { ModuleMetadata, Type } from '@nestjs/common';
import { CanActivate } from '@nestjs/common';

export enum McpTransportType {
  SSE = 'sse',
  STREAMABLE_HTTP = 'streamable-http',
  // TODO: change name since now we have stdio
  BOTH = 'both',
  STDIO = 'stdio',
}

export interface McpOptions {
  name: string;
  version: string;
  transport?: McpTransportType;
  sseEndpoint?: string;
  messagesEndpoint?: string;
  mcpEndpoint?: string;
  globalApiPrefix?: string;
  capabilities?: Record<string, any>;
  guards?: Type<CanActivate>[];
  decorators?: ClassDecorator[];
  sse?: {
    pingEnabled?: boolean;
    pingIntervalMs?: number;
  };
  streamableHttp?: {
    enableJsonResponse?: boolean;
    sessionIdGenerator?: () => string;
    statelessMode?: boolean;
  };
}

export interface McpOptionsFactory {
  createMcpOptions(): Promise<McpOptions> | McpOptions;
}

export interface McpAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  useExisting?: Type<McpOptionsFactory>;
  useClass?: Type<McpOptionsFactory>;
  useFactory?: (...args: any[]) => Promise<McpOptions> | McpOptions;
  inject?: any[];
}
