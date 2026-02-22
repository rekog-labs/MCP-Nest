import { Injectable, Inject, Logger } from '@nestjs/common';
import { z } from 'zod';
import {
  DynamicToolDefinition,
  DynamicToolHandler,
} from '../interfaces/dynamic-tool.interface';
import {
  DynamicResourceDefinition,
  DynamicResourceHandler,
} from '../interfaces/dynamic-resource.interface';
import {
  DynamicPromptDefinition,
  DynamicPromptHandler,
} from '../interfaces/dynamic-prompt.interface';
import { McpRegistryService } from './mcp-registry.service';
import type { McpOptions } from '../interfaces';
import { createMcpLogger } from '../utils/mcp-logger.factory';
import { ToolMetadata } from '../decorators/tool.decorator';
import { ResourceMetadata } from '../decorators/resource.decorator';
import { PromptMetadata } from '../decorators/prompt.decorator';

/**
 * Symbol used to identify dynamic tools in the registry.
 * When a tool's providerClass equals this token, it's a dynamic tool.
 */
export const DYNAMIC_TOOL_HANDLER_TOKEN = Symbol('DYNAMIC_TOOL_HANDLER');
export const DYNAMIC_RESOURCE_HANDLER_TOKEN = Symbol(
  'DYNAMIC_RESOURCE_HANDLER',
);
export const DYNAMIC_PROMPT_HANDLER_TOKEN = Symbol('DYNAMIC_PROMPT_HANDLER');

/**
 * Global maps of dynamic capability handlers, scoped by moduleId.
 * Using module-level Maps ensures handlers persist across different
 * McpDynamicCapabilityRegistryService instances that may be created by the DI container.
 */
const globalHandlers = new Map<string, Map<string, DynamicToolHandler>>();
const globalResourceHandlers = new Map<
  string,
  Map<string, DynamicResourceHandler>
>();
const globalPromptHandlers = new Map<
  string,
  Map<string, DynamicPromptHandler>
>();

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
 *     private readonly capabilityBuilder: McpDynamicCapabilityRegistryService,
 *     private readonly dbService: DatabaseService,
 *   ) {}
 *
 *   async onModuleInit() {
 *     const collections = await this.dbService.getCollections();
 *
 *     this.capabilityBuilder.registerTool({
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
export class McpDynamicCapabilityRegistryService {
  private readonly logger: Logger;

  constructor(
    private readonly registry: McpRegistryService,
    @Inject('MCP_MODULE_ID') private readonly mcpModuleId: string,
    @Inject('MCP_OPTIONS') private readonly options: McpOptions,
  ) {
    this.logger = createMcpLogger(McpDynamicCapabilityRegistryService.name, this.options);
    [globalHandlers, globalResourceHandlers, globalPromptHandlers].forEach(
      (store) => {
        if (!store.has(mcpModuleId)) {
          store.set(mcpModuleId, new Map());
        }
      },
    );
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
   * registry.registerTool({
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
    this.registry.registerDynamicCapability(this.mcpModuleId, {
      type: 'tool',
      metadata,
      providerClass: DYNAMIC_TOOL_HANDLER_TOKEN,
      methodName: definition.name,
    });
  }

  getHandler(toolName: string): DynamicToolHandler | undefined {
    return globalHandlers.get(this.mcpModuleId)?.get(toolName);
  }

  static getHandlerByModuleId(
    mcpModuleId: string,
    toolName: string,
  ): DynamicToolHandler | undefined {
    return globalHandlers.get(mcpModuleId)?.get(toolName);
  }

  registerResource(definition: DynamicResourceDefinition): void {
    this.logger.debug(`Registering dynamic resource: ${definition.uri}`);

    globalResourceHandlers
      .get(this.mcpModuleId)!
      .set(definition.uri, definition.handler);

    const metadata: ResourceMetadata = {
      uri: definition.uri,
      name: definition.name ?? definition.uri,
      description: definition.description,
      mimeType: definition.mimeType,
      _meta: definition._meta,
    };

    this.registry.registerDynamicCapability(this.mcpModuleId, {
      type: 'resource',
      metadata,
      providerClass: DYNAMIC_RESOURCE_HANDLER_TOKEN,
      methodName: definition.uri,
    });
  }

  static getResourceHandlerByModuleId(
    mcpModuleId: string,
    uri: string,
  ): DynamicResourceHandler | undefined {
    return globalResourceHandlers.get(mcpModuleId)?.get(uri);
  }

  registerPrompt(definition: DynamicPromptDefinition): void {
    this.logger.debug(`Registering dynamic prompt: ${definition.name}`);

    globalPromptHandlers
      .get(this.mcpModuleId)!
      .set(definition.name, definition.handler);

    const metadata: PromptMetadata = {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    };

    this.registry.registerDynamicCapability(this.mcpModuleId, {
      type: 'prompt',
      metadata,
      providerClass: DYNAMIC_PROMPT_HANDLER_TOKEN,
      methodName: definition.name,
    });
  }

  static getPromptHandlerByModuleId(
    mcpModuleId: string,
    name: string,
  ): DynamicPromptHandler | undefined {
    return globalPromptHandlers.get(mcpModuleId)?.get(name);
  }

  removeTool(name: string): void {
    this.logger.debug(`Removing dynamic tool: ${name}`);
    globalHandlers.get(this.mcpModuleId)?.delete(name);
    this.registry.removeDynamicCapability(this.mcpModuleId, 'tool', name);
  }

  removeResource(uri: string): void {
    this.logger.debug(`Removing dynamic resource: ${uri}`);
    globalResourceHandlers.get(this.mcpModuleId)?.delete(uri);
    this.registry.removeDynamicCapability(this.mcpModuleId, 'resource', uri);
  }

  removePrompt(name: string): void {
    this.logger.debug(`Removing dynamic prompt: ${name}`);
    globalPromptHandlers.get(this.mcpModuleId)?.delete(name);
    this.registry.removeDynamicCapability(this.mcpModuleId, 'prompt', name);
  }
}
