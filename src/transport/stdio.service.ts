import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef, ContextIdFactory } from '@nestjs/core';
import { McpOptions, McpTransportType } from '../interfaces';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpExecutorService } from '../services/mcp-executor.service';

@Injectable()
export class StdioService implements OnModuleInit {
  private readonly logger = new Logger(StdioService.name);

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit() {
    if (this.options.transport !== McpTransportType.STDIO) {
      return;
    }
    this.logger.log('Bootstrapping MCP STDIO...');

    const mcpServer = new McpServer(
      { name: this.options.name, version: this.options.version },
      { capabilities: this.options.capabilities || {} },
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
