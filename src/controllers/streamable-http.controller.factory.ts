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
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CanActivate } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpOptions } from '../interfaces';
import { McpRegistryService } from '../services/mcp-registry.service';
import { McpExecutorService } from '../services/mcp-executor.service';

/**
 * Creates a controller for handling Streamable HTTP connections and tool executions
 */
export function createStreamableHttpController(
  endpoint: string,
  globalApiPrefix: string,
  guards: Type<CanActivate>[] = [],
) {
  @Controller()
  class StreamableHttpController implements OnModuleInit {
    public readonly logger = new Logger(StreamableHttpController.name);
    public transports: { [sessionId: string]: StreamableHTTPServerTransport } =
      {};
    public mcpServers: { [sessionId: string]: McpServer } = {};

    constructor(
      @Inject('MCP_OPTIONS') public readonly options: McpOptions,
      public readonly moduleRef: ModuleRef,
      public readonly toolRegistry: McpRegistryService,
    ) {}

    onModuleInit() {
      this.logger.log(
        `Initialized MCP Streamable HTTP controller at ${endpoint}`,
      );
    }

    /**
     * Main HTTP endpoint for both initialization and subsequent requests
     */
    @Post(endpoint)
    @UseGuards(...guards)
    async handlePostRequest(
      @Req() req: Request,
      @Res() res: Response,
      @Body() body: unknown,
    ) {
      this.logger.debug('Received MCP request:', body);

      try {
        // Check for existing session ID
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        let transport: StreamableHTTPServerTransport;

        if (sessionId && this.transports[sessionId]) {
          // Reuse existing transport
          transport = this.transports[sessionId];
        } else if (!sessionId && this.isInitializeRequest(body)) {
          // New initialization request
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator:
              this.options.streamableHttp?.sessionIdGenerator ||
              (() => randomUUID()),
            enableJsonResponse:
              this.options.streamableHttp?.enableJsonResponse || false,
          });

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

          // Connect the transport to the MCP server BEFORE handling the request
          await mcpServer.connect(transport);

          // Handle the initialization request
          await transport.handleRequest(req, res, body);

          // Store the transport and server by session ID for future requests
          if (transport.sessionId) {
            this.transports[transport.sessionId] = transport;
            this.mcpServers[transport.sessionId] = mcpServer;

            // Set up cleanup when connection closes
            transport.onclose = () => {
              this.cleanupSession(transport.sessionId!);
            };
          }

          this.logger.log(
            `Initialized new session with ID: ${transport.sessionId}`,
          );
          return; // Already handled
        } else {
          // Invalid request - no session ID or not initialization request
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Bad Request: No valid session ID provided',
            },
            id: null,
          });
          return;
        }

        // For subsequent requests to an existing session
        const mcpServer = this.mcpServers[sessionId];
        if (!mcpServer) {
          res.status(404).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Session not found',
            },
            id: null,
          });
          return;
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

        // Handle the request with existing transport
        await transport.handleRequest(req, res, body);
      } catch (error) {
        this.logger.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    }

    /**
     * GET endpoint for SSE streams
     */
    @Get(endpoint)
    @UseGuards(...guards)
    async handleGetRequest(@Req() req: Request, @Res() res: Response) {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (!sessionId || !this.transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      this.logger.debug(`Establishing SSE stream for session ${sessionId}`);
      const transport = this.transports[sessionId];
      await transport.handleRequest(req, res);
    }

    // Helper function to detect initialize requests
    public isInitializeRequest(body: unknown): boolean {
      if (Array.isArray(body)) {
        return body.some(
          (msg) =>
            typeof msg === 'object' &&
            msg !== null &&
            'method' in msg &&
            msg.method === 'initialize',
        );
      }
      return (
        typeof body === 'object' &&
        body !== null &&
        'method' in body &&
        body.method === 'initialize'
      );
    }

    // Clean up session resources
    public cleanupSession(sessionId: string): void {
      if (sessionId) {
        this.logger.debug(`Cleaning up session: ${sessionId}`);
        delete this.transports[sessionId];
        delete this.mcpServers[sessionId];
      }
    }
  }

  return StreamableHttpController;
}
