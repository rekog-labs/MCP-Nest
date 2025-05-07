import {
  Body,
  CanActivate,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  OnModuleInit,
  Post,
  Req,
  Res,
  Type,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpOptions } from '../interfaces';
import { McpExecutorService } from '../services/mcp-executor.service';
import { McpRegistryService } from '../services/mcp-registry.service';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * Creates a controller for handling Streamable HTTP connections and tool executions
 */
export function createStreamableHttpController(
  endpoint: string,
  globalApiPrefix: string,
  guards: Type<CanActivate>[] = [],
  decorators: ClassDecorator[] = [],
) {
  @Controller()
  @applyDecorators(...decorators)
  class StreamableHttpController implements OnModuleInit {
    public readonly logger = new Logger(StreamableHttpController.name);
    public transports: { [sessionId: string]: StreamableHTTPServerTransport } =
      {};
    public mcpServers: { [sessionId: string]: McpServer } = {};

    // Singleton instances for stateless mode
    public statelessTransport: StreamableHTTPServerTransport | null = null;
    public statelessMcpServer: McpServer | null = null;
    public isStatelessMode: boolean = false;

    constructor(
      @Inject('MCP_OPTIONS') public readonly options: McpOptions,
      public readonly moduleRef: ModuleRef,
      public readonly toolRegistry: McpRegistryService,
    ) {
      // Determine if we're in stateless mode
      this.isStatelessMode = !!options.streamableHttp?.statelessMode;

      // Initialize stateless mode if needed
      if (this.isStatelessMode) {
        this.initializeStatelessMode()
          .then(() => {
            this.logger.debug('Stateless mode initialized');
          })
          .catch((error) => {
            this.logger.error('Error initializing stateless mode:', error);
          });
      }
    }

    /**
     * Initialize the stateless mode with singleton transport and server
     */
    public async initializeStatelessMode(): Promise<void> {
      this.logger.log('Initializing MCP Streamable HTTP in stateless mode');

      // Create a singleton transport for all requests
      this.statelessTransport = new StreamableHTTPServerTransport({
        // statelessMode: true, // TODO: Uncomment when this PR is merged and released: https://github.com/modelcontextprotocol/typescript-sdk/pull/362
        sessionIdGenerator: undefined,
        enableJsonResponse:
          this.options.streamableHttp?.enableJsonResponse || false,
      });

      // TODO: Remove when this PR is merged and released: https://github.com/modelcontextprotocol/typescript-sdk/pull/362
      (this.statelessTransport as any)._initialized = true;

      // Create a singleton MCP server instance
      this.statelessMcpServer = new McpServer(
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

      // Connect the transport to the MCP server
      await this.statelessMcpServer.connect(this.statelessTransport);
    }

    onModuleInit() {
      this.logger.log(
        `Initialized MCP Streamable HTTP controller at ${endpoint} in ${
          this.isStatelessMode ? 'stateless' : 'stateful'
        } mode`,
      );
    }

    /**
     * Main HTTP endpoint for both initialization and subsequent requests
     */
    @Post(`${globalApiPrefix}/${endpoint}`.replace(/\/+/g, '/'))
    @UseGuards(...guards)
    async handlePostRequest(
      @Req() req: Request,
      @Res() res: Response,
      @Body() body: unknown,
    ) {
      this.logger.debug('Received MCP request:', body);

      try {
        if (this.isStatelessMode) {
          return this.handleStatelessRequest(req, res, body);
        } else {
          return this.handleStatefulRequest(req, res, body);
        }
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
     * Handle requests in stateless mode
     */
    public async handleStatelessRequest(
      req: Request,
      res: Response,
      body: unknown,
    ): Promise<void> {
      if (!this.statelessTransport || !this.statelessMcpServer) {
        await this.initializeStatelessMode();
      }

      // ToDo: This will likely change.
      // Handle initialize requests directly
      if (this.isInitializeRequest(body)) {
        // Check and respond here
        const acceptHeader = (req.headers['accept'] as string) || '';
        const isEventStream = acceptHeader.includes('text/event-stream');
        if (isEventStream) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.flushHeaders?.();
        } else {
          res.setHeader('Content-Type', 'application/json');
        }
        const payload: JSONRPCMessage = {
          jsonrpc: '2.0',
          id: (body as any).id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: this.options.capabilities || {},
            instructions: this.options.instructions || '',
            serverInfo: {
              name: this.options.name,
              version: this.options.version,
            },
          },
        };
        if (isEventStream) {
          const messageId = randomUUID() + '_' + Date.now();
          res.write(
            'event: message\nid: ' +
              messageId +
              '\ndata: ' +
              JSON.stringify(payload) +
              '\n\n',
          );
          res.end();
        } else {
          res.json(payload);
        }
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
      executor.registerRequestHandlers(this.statelessMcpServer!, req);

      // Handle the request with the singleton transport
      await this.statelessTransport!.handleRequest(req, res, body);
    }

    /**
     * Handle requests in stateful mode
     */
    public async handleStatefulRequest(
      req: Request,
      res: Response,
      body: unknown,
    ): Promise<void> {
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
        { strict: false },
      );

      // Register request handlers with the user context from this specific request
      executor.registerRequestHandlers(mcpServer, req);

      // Handle the request with existing transport
      await transport.handleRequest(req, res, body);
    }

    /**
     * GET endpoint for SSE streams
     */
    @Get(endpoint)
    @UseGuards(...guards)
    async handleGetRequest(@Req() req: Request, @Res() res: Response) {
      if (this.isStatelessMode) {
        return this.handleStatelessRequest(req, res, req.body);
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (!sessionId || !this.transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      this.logger.debug(`Establishing SSE stream for session ${sessionId}`);
      const transport = this.transports[sessionId];
      await transport.handleRequest(req, res);
    }

    /**
     * DELETE endpoint for terminating sessions
     */
    @Delete(endpoint)
    @UseGuards(...guards)
    async handleDeleteRequest(@Req() req: Request, @Res() res: Response) {
      if (this.isStatelessMode) {
        // In stateless mode, we don't have sessions to delete
        res.status(200).end();
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (!sessionId || !this.transports[sessionId]) {
        res.status(400).send('Invalid or missing session ID');
        return;
      }

      this.logger.debug(`Terminating session ${sessionId}`);
      const transport = this.transports[sessionId];
      await transport.handleRequest(req, res);
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
