import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Scope,
  Type,
} from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { DiscoveredTool, McpRegistryService } from '../mcp-registry.service';
import { McpHandlerBase } from './mcp-handler.base';
import { ZodTypeAny } from 'zod';
import { HttpRequest } from '../../interfaces/http-adapter.interface';
import { McpRequestWithUser } from 'src/authz';
import { ToolMetadata } from '../../decorators';

@Injectable({ scope: Scope.REQUEST })
export class McpToolsHandler extends McpHandlerBase {
  constructor(
    moduleRef: ModuleRef,
    registry: McpRegistryService,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
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

  private formatToolResult(result: any, outputSchema?: ZodTypeAny): any {
    if (result && typeof result === 'object' && Array.isArray(result.content)) {
      return result;
    }

    if (outputSchema) {
      const validation = outputSchema.safeParse(result);
      if (!validation.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool result does not match outputSchema: ${validation.error.message}`,
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

  /**
   * Creates a minimal ExecutionContext for guard evaluation.
   */
  private createExecutionContext(
    httpRequest: HttpRequest,
    tool: DiscoveredTool<ToolMetadata>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: <T = unknown>() => httpRequest.raw as T,
        getResponse: <T = unknown>() => null as T,
        getNext: <T = unknown>() => undefined as T,
      }),
      getClass: <T = unknown>() => tool.providerClass as Type<T>,
      getHandler: () => (() => {}) as () => void,
      getArgs: <T extends unknown[] = unknown[]>() => [httpRequest.raw] as T,
      getArgByIndex: <T = unknown>(index: number) =>
        (index === 0 ? httpRequest.raw : undefined) as T,
      getType: <TContext extends string = string>() => 'http' as TContext,
      switchToRpc: () => ({
        getData: <T = unknown>() => undefined as T,
        getContext: <T = unknown>() => undefined as T,
      }),
      switchToWs: () => ({
        getData: <T = unknown>() => undefined as T,
        getClient: <T = unknown>() => undefined as T,
        getPattern: () => undefined as unknown as string,
      }),
    };
  }

  /**
   * Check if all guards for a tool pass.
   * Returns true if tool has no guards or all guards pass.
   */
  private async checkToolGuards(
    tool: DiscoveredTool<ToolMetadata>,
    httpRequest: HttpRequest,
  ): Promise<boolean> {
    const guards = tool.metadata.guards;
    if (!guards || guards.length === 0) {
      return true;
    }

    const context = this.createExecutionContext(httpRequest, tool);

    for (const GuardClass of guards) {
      try {
        const guard = this.moduleRef.get<CanActivate>(GuardClass, {
          strict: false,
        });
        const result = guard.canActivate(context);
        const canActivate =
          result instanceof Promise ? await result : result;
        if (!canActivate) {
          return false;
        }
      } catch (error) {
        this.logger.debug(
          `Guard ${GuardClass.name} threw an error: ${error.message}`,
        );
        return false;
      }
    }

    return true;
  }

  registerHandlers(mcpServer: McpServer, httpRequest: HttpRequest) {
    if (this.registry.getTools(this.mcpModuleId).length === 0) {
      this.logger.debug('No tools registered, skipping tool handlers');
      return;
    }

    mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const allTools = this.registry.getTools(this.mcpModuleId);

      // Filter tools based on guard checks
      const accessibleTools: DiscoveredTool<ToolMetadata>[] = [];
      for (const tool of allTools) {
        const canAccess = await this.checkToolGuards(tool, httpRequest);
        if (canAccess) {
          accessibleTools.push(tool);
        }
      }

      const tools = accessibleTools.map((tool) => {
        // Create base schema
        const toolSchema: Record<string, unknown> = {
          name: tool.metadata.name,
          description: tool.metadata.description,
          annotations: tool.metadata.annotations,
          _meta: tool.metadata._meta,
        };

        // Add input schema if defined
        if (tool.metadata.parameters) {
          toolSchema['inputSchema'] = zodToJsonSchema(tool.metadata.parameters);
        }

        // Add output schema if defined, ensuring it has type: 'object'
        if (tool.metadata.outputSchema) {
          const outputSchema = zodToJsonSchema(tool.metadata.outputSchema);

          // Create a new object that explicitly includes type: 'object'
          const jsonSchema = {
            ...outputSchema,
            type: 'object',
          };

          toolSchema['outputSchema'] = jsonSchema;
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

        // Check guards before execution (same check as listing)
        const canAccess = await this.checkToolGuards(toolInfo, httpRequest);
        if (!canAccess) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            `Access denied: insufficient permissions for tool '${request.params.name}'`,
          );
        }

        try {
          // Validate input parameters against the tool's schema
          if (toolInfo.metadata.parameters) {
            const validation = toolInfo.metadata.parameters.safeParse(
              request.params.arguments || {},
            );
            if (!validation.success) {
              throw new McpError(
                ErrorCode.InvalidParams,
                `Invalid parameters: ${validation.error.message}`,
              );
            }
            // Use validated arguments to ensure defaults and transformations are applied
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

          const transformedResult = this.formatToolResult(
            result,
            toolInfo.metadata.outputSchema,
          );

          this.logger.debug(transformedResult, 'CallToolRequestSchema result');

          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return transformedResult;
        } catch (error) {
          this.logger.error(error);
          // Re-throw McpErrors (like validation errors) so they are handled by the MCP protocol layer
          if (error instanceof McpError) {
            throw error;
          }
          // For other errors, return formatted error response
          return {
            content: [{ type: 'text', text: error.message }],
            isError: true,
          };
        }
      },
    );
  }
}
