import {
  Body,
  CanActivate,
  Controller,
  Get,
  Inject,
  Logger,
  OnModuleInit,
  Post,
  Req,
  Res,
  Type,
  UseGuards,
  VERSION_NEUTRAL,
  applyDecorators,
} from '@nestjs/common';
import { ApplicationConfig, ContextIdFactory, ModuleRef } from '@nestjs/core';
import type { Request, Response } from 'express';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { buildMcpCapabilities } from '../utils/capabilities-builder';
import { McpOptions } from '../interfaces';
import { McpExecutorService } from '../services/mcp-executor.service';
import { McpRegistryService } from '../services/mcp-registry.service';
import { SsePingService } from '../services/sse-ping.service';
import { normalizeEndpoint } from '../utils/normalize-endpoint';

/**
 * Creates a controller for handling SSE connections and tool executions
 */
export function createSseController(
  sseEndpoint: string,
  messagesEndpoint: string,
  guards: Type<CanActivate>[] = [],
  decorators: ClassDecorator[] = [],
) {
  @Controller({
    version: VERSION_NEUTRAL,
  })
  @applyDecorators(...decorators)
  class SseController implements OnModuleInit {
    readonly logger = new Logger(SseController.name);
    // Note: Currently, storing transports and servers in memory makes this not viable for scaling out.
    // Redis can be used for this purpose, but considering that HTTP Streamable succeeds SSE then we can drop keeping this in memory.

    // Map to store active transports by session ID
    public transports = new Map<string, SSEServerTransport>();
    // Map to store MCP server instances by session ID
    public mcpServers = new Map<string, McpServer>();

    constructor(
      @Inject('MCP_OPTIONS') public readonly options: McpOptions,
      @Inject('MCP_MODULE_ID') public readonly mcpModuleId: string,
      public readonly applicationConfig: ApplicationConfig,
      public readonly moduleRef: ModuleRef,
      public readonly toolRegistry: McpRegistryService,
      @Inject(SsePingService) public readonly pingService: SsePingService,
    ) {}

    /**
     * Initialize the controller and configure ping service
     */
    onModuleInit() {
      // Configure ping service with options
      this.pingService.configure({
        pingEnabled: this.options.sse?.pingEnabled, // Enable by default
        pingIntervalMs: this.options.sse?.pingIntervalMs,
      });
    }

    /**
     * SSE connection endpoint
     */
    @Get(sseEndpoint)
    @UseGuards(...guards)
    async sse(@Res() res: Response) {
      const transport = new SSEServerTransport(
        normalizeEndpoint(
          `${this.applicationConfig.getGlobalPrefix()}/${messagesEndpoint}`,
        ),
        res,
      );
      const sessionId = transport.sessionId;

      // Create a new MCP server instance with dynamic capabilities
      const capabilities = buildMcpCapabilities(
        this.mcpModuleId,
        this.toolRegistry,
        this.options,
      );
      this.logger.debug('Built MCP capabilities:', capabilities);

      // Create a new MCP server for this session with dynamic capabilities
      const mcpServer = new McpServer(
        { name: this.options.name, version: this.options.version },
        {
          capabilities,
          instructions: this.options.instructions || '',
        },
      );

      // Store the transport and server for this session
      this.transports.set(sessionId, transport);
      this.mcpServers.set(sessionId, mcpServer);

      // Register the connection with the ping service
      this.pingService.registerConnection(sessionId, transport, res);

      transport.onclose = () => {
        // Clean up when the connection closes
        this.transports.delete(sessionId);
        this.mcpServers.delete(sessionId);
        this.pingService.removeConnection(sessionId);
      };

      await mcpServer.connect(transport);
    }

    /**
     * Tool execution endpoint - protected by the provided guards
     */
    @Post(messagesEndpoint)
    @UseGuards(...guards)
    async messages(
      @Req() req: Request,
      @Res() res: Response,
      @Body() body: unknown,
    ) {
      const sessionId = req.query.sessionId as string;
      const transport = this.transports.get(sessionId);

      if (!transport) {
        return res.status(404).send('Session not found');
      }

      const mcpServer = this.mcpServers.get(sessionId);
      if (!mcpServer) {
        return res.status(404).send('MCP server not found for session');
      }

      // Resolve the request-scoped tool executor service
      const contextId = ContextIdFactory.getByRequest(req);
      const executor = await this.moduleRef.resolve(
        McpExecutorService,
        contextId,
      );

      // Register request handlers with the user context from this specific request
      executor.registerRequestHandlers(mcpServer, req);

      // Process the message
      await transport.handlePostMessage(req, res, body);
    }
  }

  return SseController;
}
