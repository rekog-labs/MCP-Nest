import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { HttpAdapterFactory } from '../adapters/http-adapter.factory';
import { HttpRequest, HttpResponse } from '../interfaces/http-adapter.interface';
import { McpOptions } from '../interfaces';
import { McpExecutorService } from './mcp-executor.service';
import { McpRegistryService } from './mcp-registry.service';
import { buildMcpCapabilities } from '../utils/capabilities-builder';

/**
 * Service handling stateful Streamable HTTP MCP traffic. Sessions are
 * maintained across requests allowing the server to preserve state between
 * calls.
 */
@Injectable()
export class McpStreamableHttpStatefulService implements OnModuleDestroy {
  private readonly logger = new Logger(McpStreamableHttpStatefulService.name);
  private readonly transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};
  private readonly mcpServers: { [sessionId: string]: McpServer } = {};
  private readonly executors: { [sessionId: string]: McpExecutorService } = {};

  constructor(
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    private readonly moduleRef: ModuleRef,
    private readonly toolRegistry: McpRegistryService,
  ) {}

  /**
   * Handle POST requests for stateful sessions.
   */
  async handlePostRequest(req: any, res: any, body: unknown): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedReq = adapter.adaptRequest(req);
    const adaptedRes = adapter.adaptResponse(res);
    const sessionId = adaptedReq.headers['mcp-session-id'] as string | undefined;

    this.logger.debug(
      `[${sessionId || 'New'}] Received MCP request: ${JSON.stringify(body)}`,
    );

    try {
      await this.handleStatefulRequest(adaptedReq, adaptedRes, body);
    } catch (error) {
      this.logger.error(
        `[${sessionId || 'No-Session'}] Error handling MCP request: ${error}`,
      );
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
   * Actual stateful request handling logic.
   */
  private async handleStatefulRequest(
    req: HttpRequest,
    res: HttpResponse,
    body: unknown,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    this.logger.debug(`[${sessionId || 'New'}] Handling stateful MCP request`);

    // Case 1: New initialization request
    if (!sessionId && this.isInitializeRequest(body)) {
      if (Array.isArray(body) && body.length > 1) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: Only one initialization request is allowed',
          },
          id: null,
        });
        return;
      }

      const capabilities = buildMcpCapabilities(
        this.mcpModuleId,
        this.toolRegistry,
        this.options,
      );

      const mcpServer = new McpServer(
        { name: this.options.name, version: this.options.version },
        {
          capabilities,
          instructions: this.options.instructions || '',
        },
      );

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator:
          this.options.streamableHttp?.sessionIdGenerator || (() => randomUUID()),
        enableJsonResponse:
          this.options.streamableHttp?.enableJsonResponse || false,
        onsessioninitialized: async (sid: string) => {
          this.logger.debug(`[${sid}] Session initialized, storing references`);
          this.transports[sid] = transport;
          this.mcpServers[sid] = mcpServer;

          const contextId = ContextIdFactory.getByRequest(req.raw ?? req);
          const executor = await this.moduleRef.resolve(
            McpExecutorService,
            contextId,
            { strict: true },
          );
          this.executors[sid] = executor;

          executor.registerRequestHandlers(mcpServer, req);
        },
        onsessionclosed: async (sid: string) => {
          this.logger.debug(`[${sid}] Session closed via DELETE`);
          await this.cleanupSession(sid);
        },
      });

      await mcpServer.connect(transport);

      await transport.handleRequest(req.raw ?? req, res.raw, body);

      this.logger.log(`[${transport.sessionId}] New session initialized`);
      return;
    }

    // Case 2: Request with session ID
    if (sessionId) {
      if (!this.transports[sessionId]) {
        this.logger.debug(`[${sessionId}] Session not found`);
        res.status(404).json({
          jsonrpc: '2.0',
          error: { code: -32001, message: 'Session not found' },
          id: null,
        });
        return;
      }

      if (this.isInitializeRequest(body)) {
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: Server already initialized',
          },
          id: null,
        });
        return;
      }

      const transport = this.transports[sessionId];

      this.logger.debug(
        `[${sessionId}] Handling request with existing session`,
      );

      await transport.handleRequest(req.raw ?? req, res.raw, body);
      return;
    }

    // Case 3: No session ID and not initialization
    res.status(400).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message: 'Bad Request: Mcp-Session-Id header is required',
      },
      id: null,
    });
  }

  /**
   * Handle GET requests for SSE streams.
   */
  async handleGetRequest(req: any, res: any): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedReq = adapter.adaptRequest(req);
    const adaptedRes = adapter.adaptResponse(res);

    const sessionId = adaptedReq.headers['mcp-session-id'] as string | undefined;

    if (!sessionId) {
      adaptedRes.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: Mcp-Session-Id header is required',
        },
        id: null,
      });
      return;
    }

    if (!this.transports[sessionId]) {
      this.logger.debug(`[${sessionId}] GET request - session not found`);
      adaptedRes.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found' },
        id: null,
      });
      return;
    }

    this.logger.debug(`[${sessionId}] Establishing SSE stream`);
    const transport = this.transports[sessionId];
    await transport.handleRequest(adaptedReq.raw ?? adaptedReq, adaptedRes.raw);
  }

  /**
   * Handle DELETE requests for terminating sessions.
   */
  async handleDeleteRequest(req: any, res: any): Promise<void> {
    const adapter = HttpAdapterFactory.getAdapter(req, res);
    const adaptedReq = adapter.adaptRequest(req);
    const adaptedRes = adapter.adaptResponse(res);

    const sessionId = adaptedReq.headers['mcp-session-id'] as string | undefined;

    if (!sessionId) {
      adaptedRes.status(400).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Bad Request: Mcp-Session-Id header is required',
        },
        id: null,
      });
      return;
    }

    if (!this.transports[sessionId]) {
      this.logger.debug(`[${sessionId}] DELETE request - session not found`);
      adaptedRes.status(404).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Session not found' },
        id: null,
      });
      return;
    }

    this.logger.debug(`[${sessionId}] Processing DELETE request`);
    const transport = this.transports[sessionId];
    await transport.handleRequest(adaptedReq.raw ?? adaptedReq, adaptedRes.raw);
  }

  /**
   * Detect initialize requests.
   */
  private isInitializeRequest(body: unknown): boolean {
    if (Array.isArray(body)) {
      return body.some(
        (msg) =>
          typeof msg === 'object' &&
          msg !== null &&
          'method' in msg &&
          (msg as any).method === 'initialize',
      );
    }
    return (
      typeof body === 'object' &&
      body !== null &&
      'method' in body &&
      (body as any).method === 'initialize'
    );
  }

  /**
   * Clean up session resources.
   */
  private async cleanupSession(sessionId: string): Promise<void> {
    if (!sessionId || !this.transports[sessionId]) {
      return;
    }

    this.logger.debug(`[${sessionId}] Cleaning up session`);

    try {
      const transport = this.transports[sessionId];
      if (transport) {
        await transport.close();
      }

      const server = this.mcpServers[sessionId];
      if (server) {
        await server.close();
      }

      delete this.transports[sessionId];
      delete this.mcpServers[sessionId];
      delete this.executors[sessionId];
    } catch (error) {
      this.logger.error(`[${sessionId}] Error during cleanup:`, error);
    }
  }

  /**
   * Clean up all sessions on module destroy.
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Cleaning up all MCP sessions...');
    const sessionIds = Object.keys(this.transports);

    await Promise.all(sessionIds.map((sid) => this.cleanupSession(sid)));

    this.logger.log(`Cleaned up ${sessionIds.length} MCP sessions`);
  }
}

