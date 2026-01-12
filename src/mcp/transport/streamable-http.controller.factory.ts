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

import type { McpOptions } from '../interfaces';
import { McpStreamableHttpService } from '../services/mcp-streamable-http.service';
import { normalizeEndpoint } from '../utils/normalize-endpoint';
import { createMcpLogger } from '../utils/mcp-logger.factory';

/**
 * Creates a controller for handling Streamable HTTP connections and tool executions
 */
export function createStreamableHttpController(
  endpoint: string,
  apiPrefix: string,
  guards: Type<CanActivate>[] = [],
  decorators: ClassDecorator[] = [],
  options?: McpOptions,
) {
  @Controller()
  @applyDecorators(...decorators)
  class StreamableHttpController {
    public readonly logger: Logger;

    constructor(
      @Inject('MCP_OPTIONS') public readonly mcpOptions: McpOptions,
      public readonly mcpStreamableHttpService: McpStreamableHttpService,
    ) {
      this.logger = createMcpLogger(
        StreamableHttpController.name,
        options || mcpOptions,
      );
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
    ): Promise<void> {
      await this.mcpStreamableHttpService.handlePostRequest(req, res, body);
    }

    /**
     * GET endpoint for SSE streams - not supported in stateless mode
     */
    @Get(`${normalizeEndpoint(`${apiPrefix}/${endpoint}`)}`)
    @UseGuards(...guards)
    async handleGetRequest(@Req() req: any, @Res() res: any): Promise<void> {
      await this.mcpStreamableHttpService.handleGetRequest(req, res);
    }

    /**
     * DELETE endpoint for terminating sessions - not supported in stateless mode
     */
    @Delete(`${normalizeEndpoint(`${apiPrefix}/${endpoint}`)}`)
    @UseGuards(...guards)
    async handleDeleteRequest(@Req() req: any, @Res() res: any): Promise<void> {
      await this.mcpStreamableHttpService.handleDeleteRequest(req, res);
    }
  }

  return StreamableHttpController;
}
