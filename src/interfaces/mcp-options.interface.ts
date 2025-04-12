import { ModuleMetadata, Type } from '@nestjs/common';
import { CanActivate } from '@nestjs/common';

export interface McpOptions {
  name: string;
  version: string;
  sseEndpoint?: string;
  messagesEndpoint?: string;
  globalApiPrefix?: string;
  capabilities?: Record<string, any>;
  guards?: Type<CanActivate>[];
  sse?: {
    pingEnabled?: boolean;
    pingIntervalMs?: number;
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
