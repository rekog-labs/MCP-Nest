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

import type { McpOptions } from '../interfaces';
import { McpSseService } from '../services/mcp-sse.service';
import { normalizeEndpoint } from '../utils/normalize-endpoint';
import { createMcpLogger } from '../utils/mcp-logger.factory';

/**
 * Creates a controller for handling SSE connections and tool executions
 */
export function createSseController(
  sseEndpoint: string,
  messagesEndpoint: string,
  apiPrefix: string,
  guards: Type<CanActivate>[] = [],
  decorators: ClassDecorator[] = [],
  options?: McpOptions,
) {
  @Controller({
    version: VERSION_NEUTRAL,
  })
  @applyDecorators(...decorators)
  class SseController implements OnModuleInit {
    readonly logger: Logger;

    constructor(
      @Inject('MCP_OPTIONS') public readonly mcpOptions: McpOptions,
      public readonly mcpSseService: McpSseService,
    ) {
      this.logger = createMcpLogger(SseController.name, options || mcpOptions);
    }

    /**
     * Initialize the controller and configure SSE service
     */
    onModuleInit() {
      this.mcpSseService.initialize();
    }

    /**
     * SSE connection endpoint
     */
    @Get(normalizeEndpoint(`${apiPrefix}/${sseEndpoint}`))
    @UseGuards(...guards)
    async sse(@Req() rawReq: any, @Res() rawRes: any) {
      return this.mcpSseService.createSseConnection(
        rawReq,
        rawRes,
        messagesEndpoint,
        apiPrefix,
      );
    }

    /**
     * Tool execution endpoint - protected by the provided guards
     */
    @Post(normalizeEndpoint(`${apiPrefix}/${messagesEndpoint}`))
    @UseGuards(...guards)
    async messages(
      @Req() rawReq: any,
      @Res() rawRes: any,
      @Body() body: unknown,
    ): Promise<void> {
      await this.mcpSseService.handleMessage(rawReq, rawRes, body);
    }
  }

  return SseController;
}
