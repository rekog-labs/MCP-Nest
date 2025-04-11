import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Injectable, Logger, Scope, Type } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  Progress,
  PromptArgument,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Request } from 'express';
import { McpRegistryService } from './mcp-registry.service';
import { Context, SerializableValue } from 'src/interfaces/mcp-tool.interface';
import { McpToolsHandler } from './handlers/mcp-tools.handler';
import { McpResourcesHandler } from './handlers/mcp-resources.handler';
import { McpPromptsHandler } from './handlers/mcp-prompts.handler';

/**
 * Request-scoped service for executing MCP tools
 */
@Injectable({ scope: Scope.REQUEST })
export class McpExecutorService {
  private logger = new Logger(McpExecutorService.name);
  private toolsHandler: McpToolsHandler;
  private resourcesHandler: McpResourcesHandler;
  private promptsHandler: McpPromptsHandler;

  constructor(moduleRef: ModuleRef, registry: McpRegistryService) {
    this.toolsHandler = new McpToolsHandler(moduleRef, registry);
    this.resourcesHandler = new McpResourcesHandler(moduleRef, registry);
    this.promptsHandler = new McpPromptsHandler(moduleRef, registry);
  }

  /**
   * Register tool-related request handlers with the MCP server
   * @param mcpServer - The MCP server instance
   * @param request - The current HTTP request object
   */
  registerRequestHandlers(mcpServer: McpServer, httpRequest: Request) {
    this.logger.debug('Registering request handlers');

    this.toolsHandler.registerHandlers(mcpServer, httpRequest);
    this.resourcesHandler.registerHandlers(mcpServer, httpRequest);
    this.promptsHandler.registerHandlers(mcpServer, httpRequest);
  }
}
