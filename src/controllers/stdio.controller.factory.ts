import {
  Controller,
  Inject,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpOptions } from '../interfaces';
import { McpRegistryService } from '../services/mcp-registry.service';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpExecutorService } from '../services/mcp-executor.service';

/**
 * Creates a controller for handling Streamable HTTP connections and tool executions
 */
export function createStdioController() {
  @Controller()
  class StdioController implements OnApplicationBootstrap {
    public readonly logger = new Logger(StdioController.name);

    constructor(
      @Inject('MCP_OPTIONS') public readonly options: McpOptions,
      public readonly toolRegistry: McpRegistryService,
      public readonly moduleRef: ModuleRef,
    ) {}

    async onApplicationBootstrap() {
      this.logger.log(`Initialized MCP STDIO controller`);

      const mcpServer = new McpServer(
        { name: this.options.name, version: this.options.version },
        {
          capabilities: this.options.capabilities || {
            tools: {},
            resources: {},
            resourceTemplates: {},
            prompts: {},
          },
        },
      );

      const contextId = ContextIdFactory.create();
      const executorService = await this.moduleRef.resolve(
        McpExecutorService,
        contextId,
        {
          strict: false,
        },
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      executorService.registerRequestHandlers(mcpServer, {} as any);

      const transport = new StdioServerTransport();

      await mcpServer.connect(transport);
    }
  }

  return StdioController;
}
