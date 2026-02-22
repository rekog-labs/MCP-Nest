import {
  Inject,
  Injectable,
  InjectionToken,
  Optional,
  Scope,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef, Reflector } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
  ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { McpRegistryService } from '../mcp-registry.service';
import { McpHandlerBase } from './mcp-handler.base';
import type { Context, McpOptions } from '../../interfaces';
import { HttpRequest } from '../../interfaces/http-adapter.interface';
import {
  McpCapabilityBuilder,
  DYNAMIC_RESOURCE_HANDLER_TOKEN,
} from '../mcp-capability-builder.service';

@Injectable({ scope: Scope.REQUEST })
export class McpResourcesHandler extends McpHandlerBase {
  constructor(
    moduleRef: ModuleRef,
    registry: McpRegistryService,
    reflector: Reflector,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    @Optional() @Inject('MCP_OPTIONS') options?: McpOptions,
  ) {
    super(moduleRef, registry, reflector, McpResourcesHandler.name, options);
  }

  registerHandlers(mcpServer: McpServer, httpRequest: HttpRequest) {
    const resources = this.registry.getResources(this.mcpModuleId);
    const resourceTemplates = this.registry.getResourceTemplates(
      this.mcpModuleId,
    );
    if (resources.length === 0 && resourceTemplates.length === 0) {
      this.logger.debug(
        'No resources or resource templates registered, skipping resource handlers',
      );
      return;
    }

    mcpServer.server.setRequestHandler(ListResourcesRequestSchema, () => {
      this.logger.debug('ListResourcesRequestSchema is being called');
      return {
        resources: this.registry
          .getResources(this.mcpModuleId)
          .map((resources) => resources.metadata),
      };
    });

    mcpServer.server.setRequestHandler(
      ListResourceTemplatesRequestSchema,
      () => {
        this.logger.debug('ListResourceTemplatesRequestSchema is being called');
        return {
          resourceTemplates: this.registry
            .getResourceTemplates(this.mcpModuleId)
            .map((resourceTemplate) => resourceTemplate.metadata),
        };
      },
    );

    mcpServer.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        this.logger.debug('ReadResourceRequestSchema is being called');

        const uri = request.params.uri;
        const resourceInfo = this.registry.findResourceByUri(
          this.mcpModuleId,
          uri,
        );
        const resourceTemplateInfo = this.registry.findResourceTemplateByUri(
          this.mcpModuleId,
          uri,
        );

        try {
          let providerClass: InjectionToken;
          let params: Record<string, unknown> = {};
          let methodName: string;
          if (resourceTemplateInfo) {
            providerClass = resourceTemplateInfo.resourceTemplate.providerClass;
            params = {
              ...resourceTemplateInfo.params,
              ...request.params,
            };
            methodName = resourceTemplateInfo.resourceTemplate.methodName;
          } else if (resourceInfo) {
            providerClass = resourceInfo.resource.providerClass;

            params = {
              ...resourceInfo.params,
              ...request.params,
            };
            methodName = resourceInfo.resource.methodName;
          } else {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown resource: ${uri}`,
            );
          }
          return await this.handleRequest(
            httpRequest,
            providerClass,
            uri,
            this.createContext(mcpServer, request),
            params,
            methodName,
          );
        } catch (error) {
          return this.handleError(
            error as Error,
            (resourceInfo?.resource ?? resourceTemplateInfo?.resourceTemplate)!,
            httpRequest,
          );
        }
      },
    );
  }

  private async handleRequest(
    httpRequest: HttpRequest,
    providerClass: InjectionToken,
    uri: string,
    context: Context,
    requestParams: Record<string, unknown>,
    methodName: string,
  ) {
    if (providerClass === DYNAMIC_RESOURCE_HANDLER_TOKEN) {
      const handler = McpCapabilityBuilder.getResourceHandlerByModuleId(
        this.mcpModuleId,
        methodName,
      );

      if (!handler) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Handler not found for dynamic resource: ${uri}`,
        );
      }

      const result = await handler(requestParams, context, httpRequest.raw);
      this.logger.debug('ReadResourceRequestSchema result', result);
      return result as ReadResourceResult;
    }

    const contextId = ContextIdFactory.getByRequest(httpRequest);
    this.moduleRef.registerRequestByContextId(httpRequest, contextId);

    const resourceInstance = await this.moduleRef.resolve(
      providerClass,
      contextId,
      { strict: false },
    );

    if (!resourceInstance) {
      throw new McpError(
        ErrorCode.MethodNotFound,
        `Unknown resource template: ${uri}`,
      );
    }
    const result = await resourceInstance[methodName].call(
      resourceInstance,
      requestParams,
      context,
      httpRequest,
    );

    this.logger.debug('ReadResourceRequestSchema result', result);

    return result as ReadResourceResult;
  }
}
