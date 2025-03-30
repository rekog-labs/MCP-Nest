import { Body, Controller, Get, Inject, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpOptions } from '../interfaces';
import { McpToolsDiscovery } from '../services/mcp-tools.discovery';
import { CleanupService } from '../services/cleanup.service';


export function createSseController(
  sseEndpoint: string,
  messagesEndpoint: string,
  globalApiPrefix: string,
) {
  @Controller()
  class SseController {
    public transports = new Map<string, SSEServerTransport>();

    constructor(
      @Inject('MCP_OPTIONS') public readonly options: McpOptions,
      public readonly mcpToolsDiscovery: McpToolsDiscovery,
      public readonly cleanupService: CleanupService,
    ) {}

    @Get(sseEndpoint)
    async sse(@Res() res: Response) {
      const transport = new SSEServerTransport(`${globalApiPrefix}/${messagesEndpoint}`, res);
      const sessionId = transport.sessionId;

      const mcpServer = new McpServer(
        { name: this.options.name, version: this.options.version },
        { capabilities: this.options.capabilities || { tools: {} } },
      );

      // Register tools (this will now also register tool-specific request handlers)
      this.mcpToolsDiscovery.registerTools(mcpServer);

      this.transports.set(sessionId, transport);

      mcpServer.server.onclose = () => {
        this.transports.delete(sessionId);
        this.cleanupService.cleanup(sessionId);
      };

      await mcpServer.connect(transport);
    }

    @Post(messagesEndpoint)
    async messages(@Req() req: Request, @Res() res: Response, @Body() body: unknown) {
      const sessionId = req.query.sessionId as string;

      const transport = this.transports.get(sessionId);

      if (!transport) {
        return res.status(404).send('Session not found');
      }
      await transport.handlePostMessage(req, res, body);
    }
  }

  return SseController;
}