import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Inject, Injectable, Scope } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { McpRequestWithUser } from 'src/authz';
import { MCP_VALIDATION_ADAPTER } from '../../decorators';
import { HttpRequest } from '../../interfaces/http-adapter.interface';
import { IValidationAdapter } from '../../interfaces/validation-adapter.interface';
import { McpRegistryService } from '../mcp-registry.service';
import { McpHandlerBase } from './mcp-handler.base';

@Injectable({ scope: Scope.REQUEST })
export class McpToolsHandler extends McpHandlerBase {
  constructor(
    moduleRef: ModuleRef,
    registry: McpRegistryService,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    @Inject(MCP_VALIDATION_ADAPTER)
    private readonly validationAdapter: IValidationAdapter,
  ) {
    super(moduleRef, registry, McpToolsHandler.name);
  }

  private buildDefaultContentBlock(result: any) {
    return [
      {
        type: 'text',
        text: JSON.stringify(result),
      },
    ];
  }

  private async formatToolResult(
    result: any,
    outputSchema?: any,
  ): Promise<any> {
    if (result && typeof result === 'object' && Array.isArray(result.content)) {
      return result;
    }

    if (outputSchema) {
      const validation = await this.validationAdapter.validate(
        outputSchema,
        result,
      );
      if (!validation.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool result does not match outputSchema: ${JSON.stringify(
            validation.error,
          )}`,
        );
      }
      return {
        structuredContent: result,
        content: this.buildDefaultContentBlock(result),
      };
    }

    return {
      content: this.buildDefaultContentBlock(result),
    };
  }

  registerHandlers(mcpServer: McpServer, httpRequest: HttpRequest) {
    if (this.registry.getTools(this.mcpModuleId).length === 0) {
      this.logger.debug('No tools registered, skipping tool handlers');
      return;
    }

    mcpServer.server.setRequestHandler(ListToolsRequestSchema, () => {
      const tools = this.registry.getTools(this.mcpModuleId).map((tool) => {
        const inputSchema = tool.metadata.parameters
          ? this.registry.getJsonSchema(tool.metadata.parameters)
          : {};

        const toolSchema = {
          name: tool.metadata.name,
          description: tool.metadata.description,
          annotations: tool.metadata.annotations,
          inputSchema: {
            ...inputSchema,
            type: 'object',
          },
          _meta: tool.metadata._meta,
        };

        if (tool.metadata.outputSchema) {
          const outputSchema = this.registry.getJsonSchema(
            tool.metadata.outputSchema,
          );
          toolSchema['outputSchema'] = {
            ...outputSchema,
            type: 'object',
          };
        }

        return toolSchema;
      });

      return {
        tools,
      };
    });

    mcpServer.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        this.logger.debug('CallToolRequestSchema is being called');

        const toolInfo = this.registry.findTool(
          this.mcpModuleId,
          request.params.name,
        );

        if (!toolInfo) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`,
          );
        }

        try {
          if (toolInfo.metadata.parameters) {
            const validation = await this.validationAdapter.validate(
              toolInfo.metadata.parameters,
              request.params.arguments || {},
            );
            if (!validation.success) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invalid parameters: ${JSON.stringify(validation.error)}`,
              );
            }
            request.params.arguments = validation.data;
          }

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
            httpRequest.raw as McpRequestWithUser,
          );

          const transformedResult = await this.formatToolResult(
            result,
            toolInfo.metadata.outputSchema,
          );

          this.logger.debug(transformedResult, 'CallToolRequestSchema result');

          return transformedResult;
        } catch (error) {
          this.logger.error(error);
          if (error instanceof McpError) {
            throw error;
          }
          return {
            content: [{ type: 'text', text: error.message }],
            isError: true,
          };
        }
      },
    );
  }
}