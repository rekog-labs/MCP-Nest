import { Inject, Injectable, Scope } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  McpError,
  PromptArgument,
} from '@modelcontextprotocol/sdk/types.js';
import { McpRegistryService } from '../mcp-registry.service';
import { McpHandlerBase } from './mcp-handler.base';
import { HttpRequest } from '../../interfaces/http-adapter.interface';
import { MCP_VALIDATION_ADAPTER } from '../../../mcp/decorators';
import { IValidationAdapter } from '../../../mcp/interfaces';

@Injectable({ scope: Scope.REQUEST })
export class McpPromptsHandler extends McpHandlerBase {
  constructor(
    moduleRef: ModuleRef,
    registry: McpRegistryService,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    @Inject(MCP_VALIDATION_ADAPTER)
    private readonly validationAdapter: IValidationAdapter,
  ) {
    super(moduleRef, registry, McpPromptsHandler.name);
  }

  registerHandlers(mcpServer: McpServer, httpRequest: HttpRequest) {
    if (this.registry.getPrompts(this.mcpModuleId).length === 0) {
      this.logger.debug('No prompts registered, skipping prompt handlers');
      return;
    }
    mcpServer.server.setRequestHandler(ListPromptsRequestSchema, () => {
      this.logger.debug('ListPromptsRequestSchema is being called');

      const prompts = this.registry
        .getPrompts(this.mcpModuleId)
        .map((prompt) => {
          let args: PromptArgument[] = [];
          if (prompt.metadata.parameters) {
            const schema = this.registry.getJsonSchema(
              prompt.metadata.parameters,
            );
            if (schema && schema.properties) {
              args = Object.entries(schema.properties).map(
                ([name, prop]: [string, any]): PromptArgument => ({
                  name,
                  description: prop.description,
                  required: schema.required?.includes(name) ?? false,
                }),
              );
            }
          }

          return {
            name: prompt.metadata.name,
            description: prompt.metadata.description,
            arguments: args,
          };
        });

      return {
        prompts,
      };
    });

    mcpServer.server.setRequestHandler(
      GetPromptRequestSchema,
      async (request) => {
        this.logger.debug('GetPromptRequestSchema is being called');

        try {
          const name = request.params.name;
          const promptInfo = this.registry.findPrompt(this.mcpModuleId, name);

          if (!promptInfo) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown prompt: ${name}`,
            );
          }

          // Prompts should always have default arguments
          const args = request.params.arguments || {};

          if (promptInfo.metadata.parameters) {
            const validation = await this.validationAdapter.validate(
              promptInfo.metadata.parameters,
              args,
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

          const promptInstance = await this.moduleRef.resolve(
            promptInfo.providerClass,
            contextId,
            { strict: false },
          );

          if (!promptInstance) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown prompt: ${name}`,
            );
          }

          const context = this.createContext(mcpServer, request);
          const methodName = promptInfo.methodName;

          const result = await promptInstance[methodName].call(
            promptInstance,
            request.params.arguments,
            context,
            httpRequest.raw,
          );

          this.logger.debug(result, 'GetPromptRequestSchema result');

          return result;
        } catch (error) {
          this.logger.error(error);
          if (error instanceof McpError) {
            throw error;
          }
          return {
            contents: [{ mimeType: 'text/plain', text: error.message }],
            isError: true,
          };
        }
      },
    );
  }
}
