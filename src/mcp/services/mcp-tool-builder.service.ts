import { Injectable, Inject, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  DynamicToolDefinition,
  DynamicToolHandler,
} from '../interfaces/dynamic-tool.interface';
import { McpRegistryService } from './mcp-registry.service';
import type { McpOptions } from '../interfaces';
import { createMcpLogger } from '../utils/mcp-logger.factory';
import { ToolMetadata } from '../decorators/tool.decorator';

/**
 * Symbol used to identify dynamic tools in the registry.
 * When a tool's providerClass equals this token, it's a dynamic tool.
 */
export const DYNAMIC_TOOL_HANDLER_TOKEN = Symbol('DYNAMIC_TOOL_HANDLER');

/**
 * Global map of dynamic tool handlers, scoped by moduleId.
 * Using a module-level Map ensures handlers persist across different
 * McpToolBuilder instances that may be created by the DI container.
 */
const globalHandlers = new Map<string, Map<string, DynamicToolHandler>>();

/**
 * Service for programmatically registering MCP tools at runtime.
 *
 * Use this to register tools with descriptions/parameters from databases
 * or other dynamic sources during application bootstrap.
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class DynamicToolsService implements OnModuleInit {
 *   constructor(
 *     private readonly toolBuilder: McpToolBuilder,
 *     private readonly dbService: DatabaseService,
 *   ) {}
 *
 *   async onModuleInit() {
 *     const collections = await this.dbService.getCollections();
 *
 *     this.toolBuilder.registerTool({
 *       name: 'search-knowledge',
 *       description: `Search collections: ${collections.join(', ')}`,
 *       parameters: z.object({ query: z.string() }),
 *       handler: async (args, context) => {
 *         const results = await this.dbService.search(args.query);
 *         return { content: [{ type: 'text', text: JSON.stringify(results) }] };
 *       },
 *     });
 *   }
 * }
 * ```
 */
@Injectable()
export class McpToolBuilder {
  private readonly logger: Logger;

  constructor(
    private readonly registry: McpRegistryService,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
  ) {
    this.logger = createMcpLogger(McpToolBuilder.name, this.options);
    // Initialize handler map for this module if it doesn't exist
    if (!globalHandlers.has(mcpModuleId)) {
      globalHandlers.set(mcpModuleId, new Map());
    }
  }

  /**
   * Register a dynamic tool for the current MCP server.
   *
   * Tools registered here will appear in the `tools/list` response and
   * can be called via `tools/call` just like decorator-based tools.
   *
   * @param definition - The tool definition including name, description, parameters, and handler
   *
   * @example
   * ```typescript
   * toolBuilder.registerTool({
   *   name: 'search-knowledge',
   *   description: await getDescriptionFromDB(),
   *   parameters: z.object({ query: z.string() }),
   *   handler: async (args, context) => {
   *     const results = await searchService.search(args.query);
   *     return { content: [{ type: 'text', text: JSON.stringify(results) }] };
   *   },
   * });
   * ```
   */
  registerTool(definition: DynamicToolDefinition): void {
    this.logger.debug(`Registering dynamic tool: ${definition.name}`);

    // Store the handler for later execution (scoped by moduleId)
    const moduleHandlers = globalHandlers.get(this.mcpModuleId)!;
    moduleHandlers.set(definition.name, definition.handler);

    // Default to empty object schema if no parameters provided (matches @Tool decorator behavior)
    const parameters = definition.parameters ?? z.object({});

    // Build metadata matching ToolMetadata interface
    const metadata: ToolMetadata = {
      name: definition.name,
      description: definition.description,
      parameters,
      outputSchema: definition.outputSchema,
      annotations: definition.annotations,
      _meta: definition._meta,
      isPublic: definition.isPublic,
      requiredScopes: definition.requiredScopes,
      requiredRoles: definition.requiredRoles,
    };

    // Register with the registry
    this.registry.registerDynamicTool(this.mcpModuleId, {
      type: 'tool',
      metadata,
      providerClass: DYNAMIC_TOOL_HANDLER_TOKEN,
      methodName: definition.name,
    });
  }

  /**
   * Get the handler function for a dynamic tool.
   * Used internally by McpToolsHandler to execute dynamic tools.
   *
   * @param toolName - The name of the tool
   * @returns The handler function, or undefined if not found
   */
  getHandler(toolName: string): DynamicToolHandler | undefined {
    return globalHandlers.get(this.mcpModuleId)?.get(toolName);
  }

  /**
   * Get the handler function for a dynamic tool by module ID.
   * Static method used when the module ID is known but the correct
   * McpToolBuilder instance may not be available.
   *
   * @param mcpModuleId - The module ID to look up handlers for
   * @param toolName - The name of the tool
   * @returns The handler function, or undefined if not found
   */
  static getHandlerByModuleId(
    mcpModuleId: string,
    toolName: string,
  ): DynamicToolHandler | undefined {
    return globalHandlers.get(mcpModuleId)?.get(toolName);
  }
}
