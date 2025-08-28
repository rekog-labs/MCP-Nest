import { Inject, Injectable, Logger } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { HttpAdapterFactory } from '../adapters/http-adapter.factory';
import { McpOptions } from '../interfaces';
import { McpExecutorService } from './mcp-executor.service';
import { McpRegistryService } from './mcp-registry.service';
import { buildMcpCapabilities } from '../utils/capabilities-builder';

/**
 * Service handling stateless Streamable HTTP MCP traffic. A new MCP server
 * instance is created for each request and cleaned up once the response is
 * sent. No session management is performed.
 */
@Injectable()
export class McpStreamableHttpStatelessService {
  private readonly logger = new Logger(McpStreamableHttpStatelessService.name);

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    private readonly moduleRef: ModuleRef,
    private readonly toolRegistry: McpRegistryService,
  ) {}

  /**
   * Handle POST requests in stateless mode.
   */
  async handlePostRequest(req: any, res: any, body: unknown): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedReq = adapter.adaptRequest(req);
    const adaptedRes = adapter.adaptResponse(res);

    this.logger.debug(
      `[Stateless] Received MCP request: ${JSON.stringify(body)}`,
    );

    let server: McpServer | null = null;
    let transport: StreamableHTTPServerTransport | null = null;

    try {
      // Create a dedicated server/transport for this request
      const created = await this.createServer(adaptedReq);
      server = created.server;
      transport = created.transport;

      // Handle the request
      await transport.handleRequest(
        adaptedReq.raw ?? adaptedReq,
        adaptedRes.raw,
        body,
      );

      // Clean up once the response finishes
      adaptedRes.raw.on('finish', async () => {
        this.logger.debug('[Stateless] Response sent, cleaning up');
        try {
          if (transport) await transport.close();
          if (server) await server.close();
        } catch (error) {
          this.logger.error('[Stateless] Error during cleanup:', error);
        }
      });
    } catch (error) {
      this.logger.error(
        `[Stateless] Error in stateless request handling: ${error}`,
      );

      // Attempt cleanup on error
      try {
        if (transport) await transport.close();
        if (server) await server.close();
      } catch (cleanupError) {
        this.logger.error(
          '[Stateless] Error cleaning up after failure:',
          cleanupError,
        );
      }

      if (!adaptedRes.headersSent) {
        adaptedRes.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  }

  /**
   * Create a new MCP server and transport for a request.
   */
  private async createServer(rawReq: any): Promise<{
    server: McpServer;
    transport: StreamableHTTPServerTransport;
  }> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: this.options.streamableHttp?.enableJsonResponse || false,
    });

    const capabilities = buildMcpCapabilities(
      this.mcpModuleId,
      this.toolRegistry,
      this.options,
    );
    this.logger.debug(
      `[Stateless] Built MCP capabilities: ${JSON.stringify(capabilities)}`,
    );

    const server = new McpServer(
      { name: this.options.name, version: this.options.version },
      {
        capabilities,
        instructions: this.options.instructions || '',
      },
    );

    // Connect the transport to the server
    await server.connect(transport);

    // Resolve executor in request scope and register handlers
    const contextId = ContextIdFactory.getByRequest(rawReq.raw ?? rawReq);
    const executor = await this.moduleRef.resolve(
      McpExecutorService,
      contextId,
      { strict: true },
    );
    executor.registerRequestHandlers(server, rawReq);

    return { server, transport };
  }
}

