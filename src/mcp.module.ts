import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { McpOptions, McpTransportType } from './interfaces';
import { McpExecutorService } from './services/mcp-executor.service';
import { McpRegistryService } from './services/mcp-registry.service';
import { McpClientService } from './services/mcp-client.service';
import { SsePingService } from './services/sse-ping.service';
import { createSseController } from './transport/sse.controller.factory';
import { StdioService } from './transport/stdio.service';
import { createStreamableHttpController } from './transport/streamable-http.controller.factory';
import { InMemoryService } from './transport/in-memory.service';

@Module({
  imports: [DiscoveryModule],
  providers: [McpRegistryService, McpExecutorService, McpClientService],
  exports: [McpClientService],
})
export class McpModule {
  static forRoot(options: McpOptions): DynamicModule {
    const defaultOptions: Partial<McpOptions> = {
      transport: [
        McpTransportType.SSE,
        McpTransportType.STREAMABLE_HTTP,
        McpTransportType.STDIO,
        McpTransportType.IN_MEMORY,
      ],
      sseEndpoint: 'sse',
      messagesEndpoint: 'messages',
      mcpEndpoint: 'mcp',
      globalApiPrefix: '',
      guards: [],
      decorators: [],
      streamableHttp: {
        enableJsonResponse: true,
        sessionIdGenerator: undefined,
        statelessMode: true,
      },
      sse: {
        pingEnabled: true,
        pingIntervalMs: 30000,
      },
    };
    const mergedOptions = { ...defaultOptions, ...options } as McpOptions;
    const providers = this.createProvidersFromOptions(mergedOptions);
    const controllers = this.createControllersFromOptions(mergedOptions); // If IN_MEMORY transport is used, add McpClientService to providers
    if (
      Array.isArray(mergedOptions.transport)
        ? mergedOptions.transport.includes(McpTransportType.IN_MEMORY)
        : mergedOptions.transport === McpTransportType.IN_MEMORY
    ) {
      providers.push(InMemoryService, McpClientService);
    }

    return {
      module: McpModule,
      controllers,
      providers,
      exports: [McpRegistryService, InMemoryService, McpClientService],
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
    const transports = Array.isArray(options.transport)
      ? options.transport
      : [options.transport ?? McpTransportType.SSE];
    const controllers: Type<any>[] = [];
    const decorators = options.decorators ?? [];

    if (transports.includes(McpTransportType.SSE)) {
      const sseController = createSseController(
        sseEndpoint,
        messagesEndpoint,
        globalApiPrefix,
        guards,
        decorators,
      );
      controllers.push(sseController);
    }

    if (transports.includes(McpTransportType.STREAMABLE_HTTP)) {
      const streamableHttpController = createStreamableHttpController(
        mcpEndpoint,
        globalApiPrefix,
        guards,
        decorators,
      );
      controllers.push(streamableHttpController);
    }

    if (transports.includes(McpTransportType.STDIO)) {
      // STDIO transport is handled by injectable StdioService, no controller
    }

    if (transports.includes(McpTransportType.IN_MEMORY)) {
      // IN_MEMORY transport is handled by injectable InMemoryService, no controller
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

    const transports = Array.isArray(options.transport)
      ? options.transport
      : [options.transport ?? McpTransportType.SSE];

    if (transports.includes(McpTransportType.SSE)) {
      providers.push(SsePingService);
    }

    if (transports.includes(McpTransportType.STDIO)) {
      providers.push(StdioService);
    }

    if (transports.includes(McpTransportType.IN_MEMORY)) {
      providers.push(InMemoryService, McpClientService);
    }

    return providers;
  }
}
