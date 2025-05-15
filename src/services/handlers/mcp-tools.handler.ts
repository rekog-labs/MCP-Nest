import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Injectable, Scope } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { Request } from 'express';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { McpRegistryService } from '../mcp-registry.service';
import { McpHandlerBase } from './mcp-handler.base';

@Injectable({ scope: Scope.REQUEST })
export class McpToolsHandler extends McpHandlerBase {
  constructor(moduleRef: ModuleRef, registry: McpRegistryService) {
    super(moduleRef, registry, McpToolsHandler.name);
  }

  registerHandlers(mcpServer: McpServer, httpRequest: Request) {
    mcpServer.server.setRequestHandler(ListToolsRequestSchema, () => {
      const tools = this.registry.getTools().map((tool) => ({
        name: tool.metadata.name,
        description: tool.metadata.description,
        inputSchema: tool.metadata.parameters
          ? zodToJsonSchema(tool.metadata.parameters)
          : undefined,
        outputSchema: tool.metadata.outputSchema
          ? zodToJsonSchema(tool.metadata.outputSchema)
          : undefined,
      }));

      return {
        tools,
      };
    });

    mcpServer.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        this.logger.debug('CallToolRequestSchema is being called');

        const toolInfo = this.registry.findTool(request.params.name);

        if (!toolInfo) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`,
          );
        }

        try {
          const contextId = ContextIdFactory.getByRequest(httpRequest);
          this.moduleRef.registerRequestByContextId(httpRequest, contextId);

          const toolInstance = await this.moduleRef.resolve(
            toolInfo.providerClass,
            contextId,
            { strict: false },
          );

          const context = this.createContext(mcpServer, request);

          if (!toolInstance) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`,
            );
          }

          const result = await toolInstance[toolInfo.methodName].call(
            toolInstance,
            request.params.arguments,
            context,
            httpRequest,
          );

          this.logger.debug(result, 'CallToolRequestSchema result');

          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return result;
        } catch (error) {
          this.logger.error(error);
          return {
            content: [{ type: 'text', text: error.message }],
            isError: true,
          };
        }
      },
    );
  }
}
