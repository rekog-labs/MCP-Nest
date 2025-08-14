import {
  Body,
  Controller,
  Get,
  Logger,
  OnModuleInit,
  Post,
  Req,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';

import { McpSseService } from '../../../src/mcp/services/mcp-sse.service';

/**
 * Advanced SSE Controller - Direct use of McpSseService
 * This controller demonstrates how to use McpSseService directly
 * instead of relying on the factory pattern
 */
@Controller({
  version: VERSION_NEUTRAL,
})
export class SseController implements OnModuleInit {
  readonly logger = new Logger(SseController.name);

  constructor(public readonly mcpSseService: McpSseService) {}

  /**
   * Initialize the controller and configure SSE service
   */
  onModuleInit() {
    this.mcpSseService.initialize();
  }

  /**
   * SSE connection endpoint
   */
  @Get('/sse')
  async sse(@Req() rawReq: any, @Res() rawRes: any) {
    return this.mcpSseService.createSseConnection(
      rawReq,
      rawRes,
      'messages',
      '', // api prefix
    );
  }

  /**
   * Tool execution endpoint
   */
  @Post('/messages')
  async messages(
    @Req() rawReq: any,
    @Res() rawRes: any,
    @Body() body: unknown,
  ): Promise<void> {
    await this.mcpSseService.handleMessage(rawReq, rawRes, body);
  }
}
