import { DynamicModule, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpOptions, McpAsyncOptions, McpOptionsFactory } from './interfaces/mcp-options.interface';

import { createSseController } from './controllers/sse.controller.factory';
import { McpToolsDiscovery } from './services/mcp-tools.discovery';
import { CleanupService } from './services/cleanup.service';

@Module({})
export class McpModule {
  static forRoot(options: McpOptions): DynamicModule {
    const sseEndpoint = options.sseEndpoint ?? 'sse';
    const messagesEndpoint = options.messagesEndpoint ?? 'messages';
    const globalApiPrefix = options.globalApiPrefix ?? '';

    const SseController = createSseController(sseEndpoint, messagesEndpoint, globalApiPrefix);

    return {
      module: McpModule,
      imports: [DiscoveryModule],
      controllers: [SseController],
      providers: [
        {
          provide: 'MCP_OPTIONS',
          useValue: options,
        },
        {
          provide: 'MCP_SERVER',
          useFactory: (mcpOptions: McpOptions) => {
            const server = new McpServer(
              { name: mcpOptions.name, version: mcpOptions.version },
              { capabilities: mcpOptions.capabilities || { tools: {} } },
            );
            return server;
          },
          inject: ['MCP_OPTIONS'],
        },
        McpToolsDiscovery,
        CleanupService,
      ],
      exports: ['MCP_SERVER'],
    };
  }

  static forRootAsync(options: McpAsyncOptions): DynamicModule {
    const providers: Provider[] = this.createAsyncProviders(options);

    return {
      module: McpModule,
      imports: [...(options.imports || []), DiscoveryModule],
      controllers: [],
      providers: [
        ...providers,
        {
          provide: 'MCP_SERVER',
          useFactory: (mcpOptions: McpOptions) => {
            const server = new McpServer(
              { name: mcpOptions.name, version: mcpOptions.version },
              { capabilities: mcpOptions.capabilities || { tools: {} } },
            );
            return server;
          },
          inject: ['MCP_OPTIONS'],
        },
        McpToolsDiscovery,
        CleanupService,
      ],
      exports: ['MCP_SERVER'],
    };
  }

  private static createAsyncProviders(options: McpAsyncOptions): Provider[] {
    if (options.useExisting || options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }

    if (!options.useClass) {
      throw new Error('useClass must be defined when not using useExisting or useFactory');
    }

    return [
      this.createAsyncOptionsProvider(options),
      {
        provide: options.useClass,
        useClass: options.useClass,
      } as Provider,
    ];
  }

  private static createAsyncOptionsProvider(options: McpAsyncOptions): Provider {
    if (options.useFactory) {
      return {
        provide: 'MCP_OPTIONS',
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    const injectionToken = options.useExisting || options.useClass;
    if (!injectionToken) {
      throw new Error('Either useExisting or useClass must be defined when not using useFactory');
    }

    return {
      provide: 'MCP_OPTIONS',
      useFactory: async (optionsFactory: McpOptionsFactory) =>
        await optionsFactory.createMcpOptions(),
      inject: [injectionToken],
    };
  }

}