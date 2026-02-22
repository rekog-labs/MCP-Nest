import { Inject, Injectable, Optional, Scope } from '@nestjs/common';
import { ContextIdFactory, ModuleRef, Reflector } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  McpError,
  PromptArgument,
} from '@modelcontextprotocol/sdk/types.js';
import { DiscoveredCapability, McpRegistryService } from '../mcp-registry.service';
import { McpHandlerBase } from './mcp-handler.base';
import { HttpRequest } from '../../interfaces/http-adapter.interface';
import type { McpOptions } from '../../interfaces/mcp-options.interface';
import { PromptMetadata } from '../../decorators';
import {
  McpDynamicCapabilityRegistryService,
  DYNAMIC_PROMPT_HANDLER_TOKEN,
} from '../mcp-dynamic-capability-registry.service';

@Injectable({ scope: Scope.REQUEST })
export class McpPromptsHandler extends McpHandlerBase {
  constructor(
    moduleRef: ModuleRef,
    registry: McpRegistryService,
    reflector: Reflector,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    @Optional() @Inject('MCP_OPTIONS') options?: McpOptions,
  ) {
    super(moduleRef, registry, reflector, McpPromptsHandler.name, options);
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
        .map((prompt) => ({
          name: prompt.metadata.name,
          description: prompt.metadata.description,
          arguments: prompt.metadata.parameters
            ? Object.entries(prompt.metadata.parameters.shape).map(
                ([name, field]): PromptArgument => ({
                  name,
                  description: field.description,
                  required: !field.isOptional(),
                }),
              )
            : [],
        }));

      return {
        prompts,
      };
    });

    mcpServer.server.setRequestHandler(
      GetPromptRequestSchema,
      async (request) => {
        this.logger.debug('GetPromptRequestSchema is being called');
        let promptInfo: DiscoveredCapability<PromptMetadata> | undefined;

        try {
          const name = request.params.name;
          promptInfo = this.registry.findPrompt(this.mcpModuleId, name);

          if (!promptInfo) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown prompt: ${name}`,
            );
          }

          const context = this.createContext(mcpServer, request);

          if (promptInfo.providerClass === DYNAMIC_PROMPT_HANDLER_TOKEN) {
            const handler = McpDynamicCapabilityRegistryService.getPromptHandlerByModuleId(
              this.mcpModuleId,
              name,
            );

            if (!handler) {
              throw new McpError(
                ErrorCode.MethodNotFound,
                `Handler not found for dynamic prompt: ${name}`,
              );
            }

            const result = await handler(
              request.params.arguments,
              context,
              httpRequest.raw,
            );

            this.logger.debug('GetPromptRequestSchema result', result);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return result;
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

          const methodName = promptInfo.methodName;

          const result = await promptInstance[methodName].call(
            promptInstance,
            request.params.arguments,
            context,
            httpRequest.raw,
          );

          this.logger.debug('GetPromptRequestSchema result', result);

          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return result;
        } catch (error) {
          this.handleError(error as Error, promptInfo!, httpRequest);
        }
      },
    );
  }
}
