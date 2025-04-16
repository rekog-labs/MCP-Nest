import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { createSseController } from './controllers/sse.controller.factory';
import { createStreamableHttpController } from './controllers/streamable-http.controller.factory';
import { McpOptions, McpTransportType } from './interfaces';
import { McpExecutorService } from './services/mcp-executor.service';
import { McpRegistryService } from './services/mcp-registry.service';
import { SsePingService } from './services/sse-ping.service';

@Module({
  imports: [DiscoveryModule],
  providers: [McpRegistryService, McpExecutorService],
})
export class McpModule {
  static forRoot(options: McpOptions): DynamicModule {
    const providers = this.createProvidersFromOptions(options);
    const controllers = this.createControllersFromOptions(options);

    return {
      module: McpModule,
      controllers,
      providers,
      exports: [McpRegistryService],
    };
  }

  private static createControllersFromOptions(
    options: McpOptions,
  ): Type<any>[] {
    const sseEndpoint = options.sseEndpoint ?? 'sse';
    const messagesEndpoint = options.messagesEndpoint ?? 'messages';
    const mcpEndpoint = options.mcpEndpoint ?? 'mcp';
    const globalApiPrefix = options.globalApiPrefix ?? '';
    const guards = options.guards ?? [];
    const transportType = options.transport ?? McpTransportType.SSE;
    const controllers: Type<any>[] = [];
    const decorators = options.decorators ?? [];

    if (
      transportType === McpTransportType.SSE ||
      transportType === McpTransportType.BOTH
    ) {
      const sseController = createSseController(
        sseEndpoint,
        messagesEndpoint,
        globalApiPrefix,
        guards,
        decorators,
      );
      controllers.push(sseController);
    }

    if (
      transportType === McpTransportType.STREAMABLE_HTTP ||
      transportType === McpTransportType.BOTH
    ) {
      const streamableHttpController = createStreamableHttpController(
        mcpEndpoint,
        globalApiPrefix,
        guards,
        decorators,
      );
      controllers.push(streamableHttpController);
    }

    return controllers;
  }

  private static createProvidersFromOptions(options: McpOptions): Provider[] {
    const providers: Provider[] = [
      {
        provide: 'MCP_OPTIONS',
        useValue: options,
      },
      McpRegistryService,
      McpExecutorService,
    ];

    const transportType = options.transport ?? McpTransportType.SSE;

    if (
      transportType === McpTransportType.SSE ||
      transportType === McpTransportType.BOTH
    ) {
      providers.push(SsePingService);
    }

    return providers;
  }
}
