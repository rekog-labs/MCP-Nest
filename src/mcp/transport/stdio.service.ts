import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { McpOptions, McpTransportType } from '../interfaces';
import { McpExecutorService } from '../services/mcp-executor.service';
import { McpRegistryService } from '../services/mcp-registry.service';
import { createMcpLogger } from '../utils/mcp-logger.factory';
import { createMcpServer } from '../utils/mcp-server.factory';

@Injectable()
export class StdioService implements OnApplicationBootstrap {
  private readonly logger: Logger;

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    private readonly moduleRef: ModuleRef,
    private readonly toolRegistry: McpRegistryService,
  ) {
    this.logger = createMcpLogger(StdioService.name, this.options);
  }

  async onApplicationBootstrap() {
    if (this.options.transport !== McpTransportType.STDIO) {
      return;
    }
    this.logger.log('Bootstrapping MCP STDIO...');

    const mcpServer = createMcpServer(
      this.mcpModuleId,
      this.toolRegistry,
      this.options,
      this.logger,
    );

    const contextId = ContextIdFactory.create();
    const executor = await this.moduleRef.resolve(
      McpExecutorService,
      contextId,
      { strict: false },
    );

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    executor.registerRequestHandlers(mcpServer, {} as any);

    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    this.logger.log('MCP STDIO ready');
  }
}
