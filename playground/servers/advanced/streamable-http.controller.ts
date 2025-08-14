import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';

import { McpStreamableHttpService } from '../../../src/mcp/services/mcp-streamable-http.service';

/**
 * Advanced Streamable HTTP Controller - Direct use of McpStreamableHttpService
 * This controller demonstrates how to use McpStreamableHttpService directly
 * instead of relying on the factory pattern
 */
@Controller()
export class StreamableHttpController {
  public readonly logger = new Logger(StreamableHttpController.name);

  constructor(
    public readonly mcpStreamableHttpService: McpStreamableHttpService,
  ) {}

  /**
   * Main HTTP endpoint for both initialization and subsequent requests
   */
  @Post('/mcp')
  async handlePostRequest(
    @Req() req: any,
    @Res() res: any,
    @Body() body: unknown,
  ): Promise<void> {
    await this.mcpStreamableHttpService.handlePostRequest(req, res, body);
  }

  /**
   * GET endpoint for SSE streams - not supported in stateless mode
   */
  @Get('/mcp')
  async handleGetRequest(@Req() req: any, @Res() res: any): Promise<void> {
    await this.mcpStreamableHttpService.handleGetRequest(req, res);
  }

  /**
   * DELETE endpoint for terminating sessions - not supported in stateless mode
   */
  @Delete('/mcp')
  async handleDeleteRequest(@Req() req: any, @Res() res: any): Promise<void> {
    await this.mcpStreamableHttpService.handleDeleteRequest(req, res);
  }
}
