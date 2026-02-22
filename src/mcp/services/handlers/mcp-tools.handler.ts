import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  CallToolResult,
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
import { ContextIdFactory, ModuleRef, Reflector } from '@nestjs/core';
import { DiscoveredCapability, McpRegistryService } from '../mcp-registry.service';
import { ToolGuardExecutionContext, ToolMetadata } from '../../decorators';
import { McpHandlerBase } from './mcp-handler.base';
import { ZodType } from 'zod';
import { HttpRequest } from '../../interfaces/http-adapter.interface';
import { McpRequestWithUser } from 'src/authz';
import { ToolAuthorizationService } from '../tool-authorization.service';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { McpOptions } from '../../interfaces/mcp-options.interface';
import {
  McpDynamicCapabilityRegistryService,
  DYNAMIC_TOOL_HANDLER_TOKEN,
} from '../mcp-dynamic-capability-registry.service';

@Injectable({ scope: Scope.REQUEST })
export class McpToolsHandler extends McpHandlerBase {
  private readonly moduleHasGuards: boolean;

  constructor(
    moduleRef: ModuleRef,
    registry: McpRegistryService,
    reflector: Reflector,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
    private readonly authService: ToolAuthorizationService,
  ) {
    super(moduleRef, registry, reflector, McpToolsHandler.name, options);
    this.moduleHasGuards =
      this.options.guards !== undefined && this.options.guards.length > 0;
  }

  private buildDefaultContentBlock(result: any) {
    return [
      {
        type: 'text',
        text: JSON.stringify(result),
      },
    ];
  }

  private formatToolResult(result: any, outputSchema?: ZodType): any {
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

  protected override createErrorResponse(
    errorText: string,
  ): CallToolResult | never {
    return {
      content: [{ type: 'text', text: errorText }],
      isError: true,
    };
  }

  /**
   * Creates an ExecutionContext for @ToolGuards() evaluation.
   *
   * Only the fields documented in ToolGuardExecutionContext are available.
   * Invalid fields throw with a descriptive message rather than silently
   * returning garbage.
   */
  private createToolGuardExecutionContext(
    httpRequest: HttpRequest,
    tool: DiscoveredCapability<ToolMetadata>,
  ): ToolGuardExecutionContext & ExecutionContext {
    const providerClass = tool.providerClass as Type;
    const methodHandler =
      providerClass.prototype?.[tool.methodName] ?? (() => {});

    const unavailable = (method: string): never => {
      throw new Error(
        `${method} is not available in @ToolGuards() context. ` +
          `MCP tools share a single HTTP endpoint, so only a limited API is available.` +
          `See ToolGuardExecutionContext for the supported API.`,
      );
    };

    return {
      switchToHttp: () => ({
        getRequest: <T = unknown>() => httpRequest.raw as T,
        getResponse: () => unavailable('switchToHttp().getResponse()'),
        getNext: () => unavailable('switchToHttp().getNext()'),
      }),
      getClass: <T = unknown>() => providerClass as Type<T>,
      getHandler: () => methodHandler as () => void,
      getArgs: () => unavailable('getArgs()'),
      getArgByIndex: () => unavailable('getArgByIndex()'),
      getType: <TContext extends string = string>() => 'http' as TContext,
      switchToRpc: () => unavailable('switchToRpc()'),
      switchToWs: () => unavailable('switchToWs()'),
    };
  }

  /**
   * Evaluates all @ToolGuards() for a tool.
   * Returns true if the tool has no guards or all guards pass.
   */
  private async checkToolGuards(
    tool: DiscoveredCapability<ToolMetadata>,
    httpRequest: HttpRequest,
  ): Promise<boolean> {
    const guards = tool.metadata.guards;
    if (!guards || guards.length === 0) {
      return true;
    }

    // Guards require HTTP context - not available on STDIO
    if (!httpRequest.raw) {
      this.logger.warn(
        `@ToolGuards() on tool '${tool.metadata.name}' cannot be evaluated without HTTP context (STDIO transport). ` +
          `The tool will be hidden. Use HTTP transport to support guarded tools.`,
      );
      return false;
    }

    const context = this.createToolGuardExecutionContext(httpRequest, tool);

    for (const GuardClass of guards) {
      try {
        const guard = this.moduleRef.get<CanActivate>(GuardClass, {
          strict: false,
        });
        const result = guard.canActivate(context);
        const canActivate = result instanceof Promise ? await result : result;
        if (!canActivate) {
          return false;
        }
      } catch (error) {
        this.logger.warn(
          `@ToolGuards() guard ${GuardClass.name} threw on tool '${tool.metadata.name}': ${error.message}. ` +
            `The tool will be hidden. If this is unexpected, ensure the guard only uses ` +
            `the API available in ToolGuardExecutionContext.`,
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
      // Extract user from request (may be undefined if not authenticated or STDIO)
      // For STDIO transport, httpRequest.raw is undefined, so bypass auth entirely
      const user = httpRequest.raw
        ? (httpRequest.raw as McpRequestWithUser).user
        : undefined;

      // Get all tools and filter based on user permissions
      // STDIO: If no httpRequest.raw, disable guards (local dev mode)
      const allTools = this.registry.getTools(this.mcpModuleId);
      const effectiveModuleHasGuards = httpRequest.raw
        ? this.moduleHasGuards
        : false;
      const allowUnauthenticatedAccess =
        this.options.allowUnauthenticatedAccess ?? false;

      // Filter by JWT-based authorization (scopes, roles, public)
      const jwtAuthorizedTools = allTools.filter((tool) =>
        this.authService.canAccessTool(
          user,
          tool,
          effectiveModuleHasGuards,
          allowUnauthenticatedAccess,
        ),
      );

      // Filter by @ToolGuards() - evaluate each tool's guards
      const authorizedTools: typeof jwtAuthorizedTools = [];
      for (const tool of jwtAuthorizedTools) {
        if (await this.checkToolGuards(tool, httpRequest)) {
          authorizedTools.push(tool);
        }
      }

      const tools = authorizedTools.map((tool) => {
        // Create base schema
        const toolSchema = {
          name: tool.metadata.name,
          description: tool.metadata.description,
          annotations: tool.metadata.annotations,
          _meta: tool.metadata._meta,
        };

        // Add security schemes
        const securitySchemes = this.authService.generateSecuritySchemes(
          tool,
          effectiveModuleHasGuards,
        );
        if (securitySchemes.length > 0) {
          toolSchema['securitySchemes'] = securitySchemes;
          // Note: Currently securitySchemes are not supported in MCP sdk, adding to _meta as workaround
          // (see https://developers.openai.com/apps-sdk/reference/)
          toolSchema._meta = {
            ...toolSchema._meta,
            securitySchemes,
          };
        }

        // Add input schema if defined
        const normalizedInputParameters = normalizeObjectSchema(
          tool.metadata.parameters,
        );
        if (normalizedInputParameters) {
          toolSchema['inputSchema'] = toJsonSchemaCompat(
            normalizedInputParameters,
          );
        }

        // Add output schema if defined, ensuring it has type: 'object'
        const normalizedOutputSchema = normalizeObjectSchema(
          tool.metadata.outputSchema,
        );
        if (normalizedOutputSchema) {
          const outputSchema = toJsonSchemaCompat(normalizedOutputSchema);

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

        // Validate authorization before execution
        // For STDIO transport, bypass auth entirely (local dev mode)
        const user = httpRequest.raw
          ? (httpRequest.raw as McpRequestWithUser).user
          : undefined;
        const effectiveModuleHasGuards = httpRequest.raw
          ? this.moduleHasGuards
          : false;
        const allowUnauthenticatedAccess =
          this.options.allowUnauthenticatedAccess ?? false;
        this.authService.validateToolAccess(
          user,
          toolInfo,
          effectiveModuleHasGuards,
          allowUnauthenticatedAccess,
        );

        // Validate @ToolGuards()
        const guardsPassed = await this.checkToolGuards(toolInfo, httpRequest);
        if (!guardsPassed) {
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
              const issues = validation.error.issues
                .map((issue) => {
                  const path =
                    issue.path.length > 0 ? issue.path.join('.') : '';
                  const location = path ? `[${path}]: ` : '';
                  return `${location}${issue.message}`;
                })
                .join('; ');
              return {
                content: [
                  {
                    type: 'text',
                    text: `Invalid parameters: ${issues}`,
                  },
                ],
                isError: true,
              };
            }
            // Use validated arguments to ensure defaults and transformations are applied
            request.params.arguments = validation.data as Record<
              string,
              unknown
            >;
          }

          const contextId = ContextIdFactory.getByRequest(httpRequest);
          this.moduleRef.registerRequestByContextId(httpRequest, contextId);

          const context = this.createContext(mcpServer, request);
          let result: any;

          // Check if this is a dynamic tool (registered via McpDynamicCapabilityRegistryService)
          if (toolInfo.providerClass === DYNAMIC_TOOL_HANDLER_TOKEN) {
            // Dynamic tool - get handler using static method with the correct moduleId
            const handler = McpDynamicCapabilityRegistryService.getHandlerByModuleId(
              this.mcpModuleId,
              request.params.name,
            );

            if (!handler) {
              throw new McpError(
                ErrorCode.MethodNotFound,
                `Handler not found for dynamic tool: ${request.params.name}`,
              );
            }

            result = await handler(
              request.params.arguments || {},
              context,
              httpRequest.raw as McpRequestWithUser,
            );
          } else {
            // Decorator-based tool - resolve provider instance and call method
            const toolInstance = await this.moduleRef.resolve(
              toolInfo.providerClass,
              contextId,
              { strict: false },
            );

            if (!toolInstance) {
              throw new McpError(
                ErrorCode.MethodNotFound,
                `Unknown tool: ${request.params.name}`,
              );
            }

            result = await toolInstance[toolInfo.methodName].call(
              toolInstance,
              request.params.arguments,
              context,
              httpRequest.raw as McpRequestWithUser,
            );
          }

          const transformedResult = this.formatToolResult(
            result,
            toolInfo.metadata.outputSchema,
          );

          this.logger.debug('CallToolRequestSchema result', transformedResult);

          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return transformedResult;
        } catch (error) {
          // We are assuming error as at least a message property
          return this.handleError(error as Error, toolInfo, httpRequest);
        }
      },
    );
  }
}
