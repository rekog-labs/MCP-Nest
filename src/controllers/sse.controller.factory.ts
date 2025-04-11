import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  Type,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CanActivate } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpOptions } from '../interfaces';
import { McpRegistryService } from '../services/mcp-registry.service';
import { McpExecutorService } from '../services/mcp-executor.service';

/**
 * Creates a controller for handling SSE connections and tool executions
 */
export function createSseController(
  sseEndpoint: string,
  messagesEndpoint: string,
  globalApiPrefix: string,
  guards: Type<CanActivate>[] = [],
) {
  @Controller()
  class SseController {
    // Note: Currently, storing transports and servers in memory makes this not viable for scaling out.
    // Redis can be used for this purpose, but considering that HTTP Streamable succeeds SSE then we can drop keeping this in memory.

    // Map to store active transports by session ID
    public transports = new Map<string, SSEServerTransport>();
    // Map to store MCP server instances by session ID
    public mcpServers = new Map<string, McpServer>();

    constructor(
      @Inject('MCP_OPTIONS') public readonly options: McpOptions,
      public readonly moduleRef: ModuleRef,
      public readonly toolRegistry: McpRegistryService,
    ) {}

    /**
     * SSE connection endpoint
     */
    @Get(sseEndpoint)
    async sse(@Res() res: Response) {
      const transport = new SSEServerTransport(
        `${globalApiPrefix}/${messagesEndpoint}`,
        res,
      );
      const sessionId = transport.sessionId;

      // Create a new MCP server for this session
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

      // Store the transport and server for this session
      this.transports.set(sessionId, transport);
      this.mcpServers.set(sessionId, mcpServer);

      transport.onclose = () => {
        // Clean up when the connection closes
        this.transports.delete(sessionId);
        this.mcpServers.delete(sessionId);
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
        { strict: false },
      );

      // Register request handlers with the user context from this specific request
      executor.registerRequestHandlers(mcpServer, req);

      // Process the message
      await transport.handlePostMessage(req, res, body);
    }
  }

  return SseController;
}
