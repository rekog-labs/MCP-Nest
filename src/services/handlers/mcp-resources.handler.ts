import { Injectable, Scope } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  ListResourcesRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Request } from 'express';
import { McpRegistryService } from '../mcp-registry.service';
import { McpHandlerBase } from './mcp-handler.base';

@Injectable({ scope: Scope.REQUEST })
export class McpResourcesHandler extends McpHandlerBase {
  constructor(moduleRef: ModuleRef, registry: McpRegistryService) {
    super(moduleRef, registry, McpResourcesHandler.name);
  }

  registerHandlers(mcpServer: McpServer, httpRequest: Request) {
    mcpServer.server.setRequestHandler(ListResourcesRequestSchema, () => {
      this.logger.debug('ListResourcesRequestSchema is being called');
      return {
        resources: this.registry
          .getResources()
          .map((resources) => resources.metadata),
      };
    });

    mcpServer.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        this.logger.debug('ReadResourceRequestSchema is being called');

        const uri = request.params.uri;
        const resourceInfo = this.registry.findResourceByUri(uri);

        if (!resourceInfo) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown resource: ${uri}`,
          );
        }

        try {
          const contextId = ContextIdFactory.getByRequest(httpRequest);
          this.moduleRef.registerRequestByContextId(httpRequest, contextId);

          const resourceInstance = await this.moduleRef.resolve(
            resourceInfo.resource.providerClass,
            contextId,
            { strict: false },
          );

          if (!resourceInstance) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown resource: ${uri}`,
            );
          }

          const context = this.createContext(mcpServer, request);

          const requestParams = {
            ...resourceInfo.params,
            ...request.params,
          };

          const methodName = resourceInfo.resource.methodName;

          const result = await resourceInstance[methodName].call(
            resourceInstance,
            requestParams,
            context,
            httpRequest,
          );

          this.logger.debug(result, 'ReadResourceRequestSchema result');

          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return result;
        } catch (error) {
          this.logger.error(error);
          return {
            contents: [{ uri, mimeType: 'text/plain', text: error.message }],
            isError: true,
          };
        }
      },
    );
  }
}
