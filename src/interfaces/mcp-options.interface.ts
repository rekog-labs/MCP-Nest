import { ModuleMetadata, Type } from '@nestjs/common';
import { CanActivate } from '@nestjs/common';

export enum McpTransportType {
  SSE = 'sse',
  STREAMABLE_HTTP = 'streamable-http',
  BOTH = 'both',
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
  sse?: {
    pingEnabled?: boolean;
    pingIntervalMs?: number;
  };
  streamableHttp?: {
    enableJsonResponse?: boolean;
    sessionIdGenerator?: () => string;
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
