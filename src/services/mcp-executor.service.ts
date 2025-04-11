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

/**
 * Request-scoped service for executing MCP tools
 */
@Injectable({ scope: Scope.REQUEST })
export class McpExecutorService {
  private logger = new Logger(McpExecutorService.name);

  // Don't inject the request directly in the constructor
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly registry: McpRegistryService,
  ) {}

  /**
   * Register tool-related request handlers with the MCP server
   * @param mcpServer - The MCP server instance
   * @param request - The current HTTP request object
   */
  registerRequestHandlers(mcpServer: McpServer, httpRequest: Request) {
    this.registerTools(mcpServer, httpRequest);
    this.registerResources(mcpServer, httpRequest);
    this.registerPrompts(mcpServer, httpRequest);
  }

  private registerPrompts(mcpServer: McpServer, httpRequest: Request) {
    mcpServer.server.setRequestHandler(ListPromptsRequestSchema, () => {
      this.logger.debug('ListPromptsRequestSchema is being called');

      const prompts = this.registry.getPrompts().map((prompt) => ({
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

        try {
          const name = request.params.name;
          const promptInfo = this.registry.findPrompt(name);

          if (!promptInfo) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown prompt: ${name}`,
            );
          }

          // Resolve the resource instance for the current request
          const contextId = ContextIdFactory.getByRequest(httpRequest);
          this.moduleRef.registerRequestByContextId(httpRequest, contextId);

          const promptInstance = await this.moduleRef.resolve(
            promptInfo.providerClass as Type<any>,
            contextId,
            { strict: false },
          );

          if (!promptInstance) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown prompt: ${name}`,
            );
          }

          // Create the execution context with user information
          const context = this.createContext(mcpServer, request);

          const methodName = promptInfo.methodName;

          // Call the resource method
          const result = await promptInstance[methodName].call(
            promptInstance,
            request.params.arguments,
            context,
            httpRequest,
          );

          this.logger.debug(result, 'GetPromptRequestSchema result');

          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return result;
        } catch (error) {
          this.logger.error(error);
          return {
            contents: [{ mimeType: 'text/plain', text: error.message }],
            isError: true,
          };
        }
      },
    );
  }

  private registerResources(mcpServer: McpServer, httpRequest: Request) {
    mcpServer.server.setRequestHandler(ListResourcesRequestSchema, () => {
      this.logger.debug('ListResourcesRequestSchema is being called');
      const data = {
        resources: this.registry
          .getResources()
          .map((resources) => resources.metadata),
      };

      return data;
    });

    mcpServer.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        this.logger.debug('ReadResourceRequestSchema is being called');

        // Support for dynamic resources, since they use uriTemplates (RFC 6570)
        // https://modelcontextprotocol.io/docs/concepts/resources#resource-templates
        const uri = request.params.uri;
        const resourceInfo = this.registry.findResourceByUri(uri);

        if (!resourceInfo) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown resource: ${uri}`,
          );
        }

        try {
          // Resolve the resource instance for the current request
          const contextId = ContextIdFactory.getByRequest(httpRequest);
          this.moduleRef.registerRequestByContextId(httpRequest, contextId);

          const resourceInstance = await this.moduleRef.resolve(
            resourceInfo.resource.providerClass as Type<any>,
            contextId,
            { strict: false },
          );

          if (!resourceInstance) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown resource: ${uri}`,
            );
          }

          // Create the execution context with user information
          const context = this.createContext(mcpServer, request);

          const requestParams = {
            ...resourceInfo.params,
            ...request.params,
          };

          const methodName = resourceInfo.resource.methodName;

          // Call the resource method
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

  private registerTools(mcpServer: McpServer, httpRequest) {
    mcpServer.server.setRequestHandler(ListToolsRequestSchema, () => {
      const tools = this.registry.getTools().map((tool) => ({
        name: tool.metadata.name,
        description: tool.metadata.description,
        inputSchema: tool.metadata.parameters
          ? // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            zodToJsonSchema(tool.metadata.parameters)
          : undefined,
      }));

      return {
        tools,
      };
    });

    // Register call tool handler
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
          // Resolve the tool instance for the current request
          const contextId = ContextIdFactory.getByRequest(httpRequest);
          this.moduleRef.registerRequestByContextId(httpRequest, contextId);

          const toolInstance = await this.moduleRef.resolve(
            toolInfo.providerClass as Type<any>,
            contextId,
            { strict: false },
          );

          // Create the execution context with user information
          const context = this.createContext(mcpServer, request);

          if (!toolInstance) {
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`,
            );
          }

          // Call the tool method
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
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

  /**
   * Create the execution context with user data from the request
   * @param mcpServer - The MCP server instance
   * @param progressToken - Optional progress token for reporting progress
   * @param mcpRequest - The current HTTP request
   */
  private createContext(
    mcpServer: McpServer,
    mcpRequest: z.infer<
      | typeof CallToolRequestSchema
      | typeof ReadResourceRequestSchema
      | typeof GetPromptRequestSchema
    >,
  ): Context {
    const progressToken = mcpRequest.params?._meta?.progressToken;
    return {
      reportProgress: async (progress: Progress) => {
        if (progressToken) {
          await mcpServer.server.notification({
            method: 'notifications/progress',
            params: {
              ...progress,
              progressToken,
            } as Progress,
          });
        }
      },
      log: {
        debug: (message: string, context?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'debug',
            data: { message, context },
          });
        },
        error: (message: string, context?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'error',
            data: { message, context },
          });
        },
        info: (message: string, context?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'info',
            data: { message, context },
          });
        },
        warn: (message: string, context?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'warning',
            data: { message, context },
          });
        },
      },
    };
  }
}
