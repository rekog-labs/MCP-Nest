import {
  Body,
  CanActivate,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Post,
  Req,
  Res,
  Type,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { HttpAdapterFactory } from '../adapters/http-adapter.factory';
import {
  HttpRequest,
  HttpResponse,
} from '../interfaces/http-adapter.interface';
import { McpOptions } from '../interfaces';
import { McpExecutorService } from '../services/mcp-executor.service';
import { McpRegistryService } from '../services/mcp-registry.service';
import { buildMcpCapabilities } from '../utils/capabilities-builder';
import { normalizeEndpoint } from '../utils/normalize-endpoint';

/**
 * Creates a controller for handling Streamable HTTP connections and tool executions
 */
export function createStreamableHttpController(
  endpoint: string,
  apiPrefix: string,
  guards: Type<CanActivate>[] = [],
  decorators: ClassDecorator[] = [],
) {
  @Controller()
  @applyDecorators(...decorators)
  class StreamableHttpController {
    public readonly logger = new Logger(StreamableHttpController.name);
    public transports: { [sessionId: string]: StreamableHTTPServerTransport } =
      {};
    public mcpServers: { [sessionId: string]: McpServer } = {};

    public isStatelessMode: boolean = false;

    constructor(
      @Inject('MCP_OPTIONS') public readonly options: McpOptions,
      @Inject('MCP_MODULE_ID') public readonly mcpModuleId: string,
      public readonly moduleRef: ModuleRef,
      public readonly toolRegistry: McpRegistryService,
    ) {
      // Determine if we're in stateless mode
      this.isStatelessMode = !!options.streamableHttp?.statelessMode;
    }

    /**
     * Create a new MCP server instance for stateless requests
     */
    async createStatelessServer(rawReq: any): Promise<{
      server: McpServer;
      transport: StreamableHTTPServerTransport;
    }> {
      // Create a new transport for this request
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse:
          this.options.streamableHttp?.enableJsonResponse || false,
      });

      // Create a new MCP server instance with dynamic capabilities
      const capabilities = buildMcpCapabilities(
        this.mcpModuleId,
        this.toolRegistry,
        this.options,
      );
      this.logger.debug('Built MCP capabilities:', capabilities);

      const server = new McpServer(
        { name: this.options.name, version: this.options.version },
        {
          capabilities: capabilities,
          instructions: this.options.instructions || '',
        },
      );

      // Connect the transport to the MCP server first
      await server.connect(transport);

      // Now resolve the request-scoped tool executor service
      const contextId = ContextIdFactory.getByRequest(rawReq);
      const executor = await this.moduleRef.resolve(
        McpExecutorService,
        contextId,
        { strict: true },
      );

      // Register request handlers after connection
      this.logger.debug(
        'Registering request handlers for stateless MCP server',
      );
      executor.registerRequestHandlers(server, rawReq);

      return { server, transport };
    }

    /**
     * Main HTTP endpoint for both initialization and subsequent requests
     */
    @Post(`${normalizeEndpoint(`${apiPrefix}/${endpoint}`)}`)
    @UseGuards(...guards)
    async handlePostRequest(
      @Req() req: any,
      @Res() res: any,
      @Body() body: unknown,
    ) {
      this.logger.debug('Received MCP request:', body);

      // Get the appropriate HTTP adapter for the request/response
      const adapter = HttpAdapterFactory.getAdapter(req, res);
      const adaptedReq = adapter.adaptRequest(req);
      const adaptedRes = adapter.adaptResponse(res);

      try {
        if (this.isStatelessMode) {
          return this.handleStatelessRequest(adaptedReq, adaptedRes, body);
        } else {
          return this.handleStatefulRequest(adaptedReq, adaptedRes, body);
        }
      } catch (error) {
        this.logger.error('Error handling MCP request:', error);
        if (!adaptedRes.headersSent) {
          adaptedRes.status(500).json({
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
     * Handle requests in stateless mode
     */
    public async handleStatelessRequest(
      req: any,
      res: HttpResponse,
      body: unknown,
    ): Promise<void> {
      this.logger.debug(
        `Handling stateless MCP request at ${req.url} with body: ${JSON.stringify(
          body,
        )}`,
      );

      let server: McpServer | null = null;
      let transport: StreamableHTTPServerTransport | null = null;

      try {
        // Create a new server and transport for each request
        const stateless = await this.createStatelessServer(req);
        server = stateless.server;
        transport = stateless.transport;

        // Handle the request
        await transport.handleRequest(req.raw, res.raw, body);

        // Clean up when the response closes
        res.on?.('close', () => {
          this.logger.debug('Stateless request closed, cleaning up');
          void transport?.close();
          void server?.close();
        });
      } catch (error) {
        this.logger.error('Error in stateless request handling:', error);
        // Clean up on error
        void transport?.close();
        void server?.close();
        throw error;
      }
    }

    /**
     * Handle requests in stateful mode
     */
    public async handleStatefulRequest(
      req: HttpRequest,
      res: HttpResponse,
      body: unknown,
    ): Promise<void> {
      this.logger.debug(
        `Handling stateful MCP request at ${req.url} with body: ${JSON.stringify(
          body,
        )}`,
      );
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

        // Create a new MCP server for this session with dynamic capabilities
        const capabilities = buildMcpCapabilities(
          this.mcpModuleId,
          this.toolRegistry,
          this.options,
        );
        this.logger.debug('Built MCP capabilities:', capabilities);

        const mcpServer = new McpServer(
          { name: this.options.name, version: this.options.version },
          {
            capabilities,
            instructions: this.options.instructions || '',
          },
        );

        // Connect the transport to the MCP server BEFORE handling the request
        await mcpServer.connect(transport);

        // Handle the initialization request
        await transport.handleRequest(req.raw, res.raw, body);

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
        return;
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
        { strict: true },
      );

      // Register request handlers with the user context from this specific request
      executor.registerRequestHandlers(mcpServer, req);

      // Handle the request with existing transport
      await transport.handleRequest(req.raw, res.raw, body);
    }

    /**
     * GET endpoint for SSE streams - not supported in stateless mode
     */
    @Get(`${normalizeEndpoint(`${apiPrefix}/${endpoint}`)}`)
    @UseGuards(...guards)
    async handleGetRequest(@Req() req: any, @Res() res: any) {
      // Get the appropriate HTTP adapter for the request/response
      const adapter = HttpAdapterFactory.getAdapter(req, res);
      const adaptedReq = adapter.adaptRequest(req);
      const adaptedRes = adapter.adaptResponse(res);

      if (this.isStatelessMode) {
        adaptedRes.status(405).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed in stateless mode',
          },
          id: null,
        });
        return;
      }

      const sessionId = adaptedReq.headers['mcp-session-id'] as
        | string
        | undefined;

      if (!sessionId || !this.transports[sessionId]) {
        adaptedRes.status(400).send('Invalid or missing session ID');
        return;
      }

      this.logger.debug(`Establishing SSE stream for session ${sessionId}`);
      const transport = this.transports[sessionId];
      await transport.handleRequest(adaptedReq.raw, adaptedRes.raw);
    }

    /**
     * DELETE endpoint for terminating sessions - not supported in stateless mode
     */
    @Delete(`${normalizeEndpoint(`${apiPrefix}/${endpoint}`)}`)
    @UseGuards(...guards)
    async handleDeleteRequest(@Req() req: any, @Res() res: any) {
      // Get the appropriate HTTP adapter for the request/response
      const adapter = HttpAdapterFactory.getAdapter(req, res);
      const adaptedReq = adapter.adaptRequest(req);
      const adaptedRes = adapter.adaptResponse(res);

      if (this.isStatelessMode) {
        adaptedRes.status(405).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed in stateless mode',
          },
          id: null,
        });
        return;
      }

      const sessionId = adaptedReq.headers['mcp-session-id'] as
        | string
        | undefined;

      if (!sessionId || !this.transports[sessionId]) {
        adaptedRes.status(400).send('Invalid or missing session ID');
        return;
      }

      this.logger.debug(`Terminating session ${sessionId}`);
      const transport = this.transports[sessionId];
      await transport.handleRequest(adaptedReq.raw, adaptedRes.raw);
      this.cleanupSession(sessionId);
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
