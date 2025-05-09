import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef, ContextIdFactory } from '@nestjs/core';
import { McpOptions, McpTransportType } from '../interfaces';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpExecutorService } from '../services/mcp-executor.service';

@Injectable()
export class InMemoryService implements OnModuleInit {
  private readonly logger = new Logger(InMemoryService.name);

  #client: Client | null = null;

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    private readonly moduleRef: ModuleRef,
  ) {}

  async onModuleInit() {
    if (this.options.transport !== McpTransportType.IN_MEMORY) {
      return;
    }
    this.logger.log('Bootstrapping MCP IN_MEMORY...');

    const mcpServer = new McpServer(
      { name: this.options.name, version: this.options.version },
      {
        capabilities: this.options.capabilities || {
          tools: {},
          resources: {},
          prompts: {},
          instructions: [],
        },
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

    const [serverTransport, clientTransport] =
      InMemoryTransport.createLinkedPair();

    await mcpServer.connect(serverTransport);

    this.#client = new Client({
      name: `${this.options.name} client`,
      version: this.options.version,
    });

    await this.#client.connect(clientTransport);

    this.logger.log('MCP IN_MEMORY ready');
  }

  get client(): Client {
    if (!this.#client) {
      throw new Error('MCP Client is not initialized');
    }

    return this.#client;
  }
}
