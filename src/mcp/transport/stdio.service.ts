import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { buildMcpCapabilities } from '../utils/capabilities-builder';

@Injectable()
export class StdioService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StdioService.name);

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    private readonly moduleRef: ModuleRef,
    private readonly toolRegistry: McpRegistryService,
  ) {}

  async onApplicationBootstrap() {
    if (this.options.transport !== McpTransportType.STDIO) {
      return;
    }
    this.logger.log('Bootstrapping MCP STDIO...');

    // Create a new MCP server instance with dynamic capabilities
    const capabilities = buildMcpCapabilities(
      this.mcpModuleId,
      this.toolRegistry,
      this.options,
    );
    this.logger.debug('Built MCP capabilities:', capabilities);

    // Create MCP server with dynamic capabilities
    const mcpServer = new McpServer(
      { name: this.options.name, version: this.options.version },
      {
        capabilities,
        instructions: this.options.instructions || '',
      },
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
