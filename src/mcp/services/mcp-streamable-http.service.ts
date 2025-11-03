import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';

import { HttpAdapterFactory } from '../adapters/http-adapter.factory';
import { McpOptions } from '../interfaces';
import { McpStreamableHttpStatelessService } from './mcp-streamable-http-stateless.service';
import { McpStreamableHttpStatefulService } from './mcp-streamable-http-stateful.service';

/**
 * Facade service that delegates Streamable HTTP requests to either a stateless
 * or stateful implementation based on configuration. This keeps the
 * high-level flow simple while the concrete logic lives in dedicated files.
 */
@Injectable()
export class McpStreamableHttpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpStreamableHttpService.name);
  private readonly isStatelessMode: boolean;

  constructor(
    @Inject('MCP_OPTIONS') options: McpOptions,
    private readonly stateless: McpStreamableHttpStatelessService,
    private readonly stateful: McpStreamableHttpStatefulService,
  ) {
    this.isStatelessMode = !!options.streamableHttp?.statelessMode;
  }

  /**
   * Handle POST requests by delegating to the appropriate implementation.
   */
  handlePostRequest(req: any, res: any, body: unknown): Promise<void> {
    return this.isStatelessMode
      ? this.stateless.handlePostRequest(req, res, body)
      : this.stateful.handlePostRequest(req, res, body);
  }

  /**
   * Handle GET requests. Only supported in stateful mode.
   */
  async handleGetRequest(req: any, res: any): Promise<void> {
    if (this.isStatelessMode) {
      const adapter = HttpAdapterFactory.getAdapter(req, res);
      const adaptedRes = adapter.adaptResponse(res);
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

    return this.stateful.handleGetRequest(req, res);
  }

  /**
   * Handle DELETE requests. Only supported in stateful mode.
   */
  async handleDeleteRequest(req: any, res: any): Promise<void> {
    if (this.isStatelessMode) {
      const adapter = HttpAdapterFactory.getAdapter(req, res);
      const adaptedRes = adapter.adaptResponse(res);
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

    return this.stateful.handleDeleteRequest(req, res);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.isStatelessMode) {
      await this.stateful.onModuleDestroy();
    }
  }
}

