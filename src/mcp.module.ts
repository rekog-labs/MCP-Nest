import { DynamicModule, Module, Provider } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import {
  McpOptions,
  McpAsyncOptions,
  McpOptionsFactory,
} from './interfaces/mcp-options.interface';

import { createSseController } from './controllers/sse.controller.factory';
import { McpRegistryService } from './services/mcp-registry.service';
import { McpExecutorService } from './services/mcp-executor.service';

@Module({})
export class McpModule {
  static forRoot(options: McpOptions): DynamicModule {
    const sseEndpoint = options.sseEndpoint ?? 'sse';
    const messagesEndpoint = options.messagesEndpoint ?? 'messages';
    const globalApiPrefix = options.globalApiPrefix ?? '';
    const guards = options.guards ?? [];

    // Create the controller with guards
    const SseController = createSseController(
      sseEndpoint,
      messagesEndpoint,
      globalApiPrefix,
      guards,
    );

    return {
      module: McpModule,
      imports: [DiscoveryModule],
      controllers: [SseController],
      providers: [
        {
          provide: 'MCP_OPTIONS',
          useValue: options,
        },
        // Register both the registry (singleton) and executor (request-scoped) services
        McpRegistryService,
        McpExecutorService,
      ],
      exports: [McpRegistryService, McpExecutorService],
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
        // Register both the registry and executor services
        McpRegistryService,
        McpExecutorService,
      ],
      exports: [McpRegistryService, McpExecutorService],
    };
  }

  /**
   * Helper to create async providers that handle different options types
   */
  private static createAsyncProviders(options: McpAsyncOptions): Provider[] {
    if (options.useExisting || options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }

    if (!options.useClass) {
      throw new Error(
        'useClass must be defined when not using useExisting or useFactory',
      );
    }

    return [
      this.createAsyncOptionsProvider(options),
      {
        provide: options.useClass,
        useClass: options.useClass,
      } as Provider,
    ];
  }

  /**
   * Create the async options provider
   */
  private static createAsyncOptionsProvider(
    options: McpAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: 'MCP_OPTIONS',
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    const injectionToken = options.useExisting || options.useClass;
    if (!injectionToken) {
      throw new Error(
        'Either useExisting or useClass must be defined when not using useFactory',
      );
    }

    return {
      provide: 'MCP_OPTIONS',
      useFactory: async (optionsFactory: McpOptionsFactory) =>
        await optionsFactory.createMcpOptions(),
      inject: [injectionToken],
    };
  }
}
