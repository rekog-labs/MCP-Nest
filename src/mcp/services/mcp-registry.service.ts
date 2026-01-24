import {
  Injectable,
  InjectionToken,
  Logger,
  OnApplicationBootstrap,
  Inject,
  Optional,
} from '@nestjs/common';
import {
  DiscoveryService,
  MetadataScanner,
  ModulesContainer,
} from '@nestjs/core';
import {
  MCP_PROMPT_METADATA_KEY,
  MCP_RESOURCE_METADATA_KEY,
  MCP_RESOURCE_TEMPLATE_METADATA_KEY,
  MCP_TOOL_METADATA_KEY,
  MCP_PUBLIC_METADATA_KEY,
  MCP_SCOPES_METADATA_KEY,
  MCP_ROLES_METADATA_KEY,
  ToolMetadata,
} from '../decorators';
import { ResourceMetadata } from '../decorators/resource.decorator';
import { match } from 'path-to-regexp';
import { PromptMetadata } from '../decorators/prompt.decorator';
import { Module } from '@nestjs/core/injector/module';
import { ResourceTemplateMetadata } from '../decorators/resource-template.decorator';
import type { McpOptions } from '../interfaces';
import { createMcpLogger } from '../utils/mcp-logger.factory';
import {
  MCP_FEATURE_REGISTRATION,
  McpFeatureRegistration,
} from '../constants/feature-registration.constants';

/**
 * Interface representing a discovered tool
 */
export type DiscoveredTool<T extends object> = {
  type: 'tool' | 'resource' | 'resource-template' | 'prompt';
  metadata: T;
  providerClass: InjectionToken;
  methodName: string;
};

export type InjectionTokenWithName = InjectionToken & { name: string };

/**
 * Singleton service that discovers and registers tools during application bootstrap
 */
@Injectable()
export class McpRegistryService implements OnApplicationBootstrap {
  private readonly logger: Logger;
  private discoveredToolsByMcpModuleId: Map<string, DiscoveredTool<any>[]> =
    new Map();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly modulesContainer: ModulesContainer,
    @Optional() @Inject('MCP_OPTIONS') private readonly options?: McpOptions,
  ) {
    this.logger = createMcpLogger(McpRegistryService.name, this.options);
  }

  onApplicationBootstrap() {
    this.discoverTools();
  }

  /**
   * Finds all modules that import the McpModule and scans only the root module providers and controllers.
   * This prevents unintentionally exposing tools from imported dependencies.
   */
  private discoverTools() {
    // First, build a map of server names to module IDs
    const serverNameToModuleId = this.buildServerNameToModuleIdMap();

    // Then, collect feature registrations
    const featureRegistrations = this.collectFeatureRegistrations();

    const getImportedMcpModules = (module: Module) =>
      Array.from(module.imports).filter(
        (m) =>
          (m.instance as any).__isMcpModule &&
          !(m.instance as any).__isMcpFeatureModule,
      );

    const pairs = Array.from(this.modulesContainer.values())
      .map((module): [Module, Module[]] => [
        module,
        getImportedMcpModules(module),
      ])
      .filter(([, importedMcpModules]) => importedMcpModules.length > 0);

    for (const [rootModule, mcpModules] of pairs) {
      this.logger.debug(
        `Discovering tools, resources, resource templates, and prompts for module: ${rootModule.name}`,
      );

      for (const mcpModule of mcpModules) {
        const mcpModuleId =
          mcpModule.getProviderByKey<string>('MCP_MODULE_ID')?.instance;

        this.discoverToolsForModuleSubtree(mcpModuleId, [rootModule]);
      }
    }

    // Process feature registrations
    this.processFeatureRegistrations(
      featureRegistrations,
      serverNameToModuleId,
    );
  }

  /**
   * Builds a map from server names to their module IDs.
   */
  private buildServerNameToModuleIdMap(): Map<string, string> {
    const map = new Map<string, string>();

    for (const module of this.modulesContainer.values()) {
      if ((module.instance as any)?.__isMcpModule) {
        const moduleId =
          module.getProviderByKey<string>('MCP_MODULE_ID')?.instance;
        const options =
          module.getProviderByKey<McpOptions>('MCP_OPTIONS')?.instance;

        if (moduleId && options?.name) {
          map.set(options.name, moduleId);
        }
      }
    }

    return map;
  }

  /**
   * Collects all feature registrations from modules that import McpModule.forFeature().
   */
  private collectFeatureRegistrations(): Array<{
    registration: McpFeatureRegistration;
    sourceModule: Module;
  }> {
    const registrations: Array<{
      registration: McpFeatureRegistration;
      sourceModule: Module;
    }> = [];

    for (const module of this.modulesContainer.values()) {
      // Check for feature registration providers (tokens start with MCP_FEATURE_REGISTRATION)
      for (const [key, provider] of module.providers) {
        if (
          typeof key === 'string' &&
          key.startsWith(MCP_FEATURE_REGISTRATION) &&
          provider?.instance
        ) {
          registrations.push({
            registration: provider.instance as McpFeatureRegistration,
            sourceModule: module,
          });
        }
      }
    }

    return registrations;
  }

  /**
   * Processes feature registrations and discovers tools from their providers.
   */
  private processFeatureRegistrations(
    registrations: Array<{
      registration: McpFeatureRegistration;
      sourceModule: Module;
    }>,
    serverNameToModuleId: Map<string, string>,
  ) {
    for (const { registration, sourceModule } of registrations) {
      const mcpModuleId = serverNameToModuleId.get(registration.serverName);

      if (!mcpModuleId) {
        this.logger.warn(
          `McpModule.forFeature: No MCP server found with name '${registration.serverName}'. ` +
            `Make sure McpModule.forRoot({ name: '${registration.serverName}', ... }) is imported.`,
        );
        continue;
      }

      this.logger.debug(
        `Processing forFeature registration for server '${registration.serverName}' ` +
          `with ${registration.providerTokens.length} provider(s)`,
      );

      // Find the module that actually provides these providers
      // The sourceModule imports the forFeature module, so we look at its parent
      const parentModule = this.findModuleWithProviders(
        registration.providerTokens,
        sourceModule,
      );

      if (parentModule) {
        this.discoverToolsFromProviders(
          mcpModuleId,
          registration.providerTokens,
          parentModule,
        );
      }
    }
  }

  /**
   * Finds a module that contains the specified providers.
   * Searches the source module and its parent modules.
   */
  private findModuleWithProviders(
    providerTokens: InjectionToken[],
    sourceModule: Module,
  ): Module | undefined {
    // First check if the source module's parent has the providers
    for (const module of this.modulesContainer.values()) {
      if (module.imports.has(sourceModule)) {
        // This module imports our source module, check if it has the providers
        const hasAllProviders = providerTokens.every((token) =>
          module.getProviderByKey(token),
        );
        if (hasAllProviders) {
          return module;
        }
      }
    }

    // Fallback: search all modules
    for (const module of this.modulesContainer.values()) {
      const hasAllProviders = providerTokens.every((token) =>
        module.getProviderByKey(token),
      );
      if (hasAllProviders) {
        return module;
      }
    }

    return undefined;
  }

  /**
   * Discovers tools from specific providers within a module.
   */
  private discoverToolsFromProviders(
    mcpModuleId: string,
    providerTokens: InjectionToken[],
    module: Module,
  ) {
    for (const token of providerTokens) {
      const provider = module.getProviderByKey(token);
      if (!provider?.instance || typeof provider.instance !== 'object') {
        this.logger.warn(
          `McpModule.forFeature: Provider '${String(token)}' not found or not instantiated`,
        );
        continue;
      }

      const instance = provider.instance as object;
      this.metadataScanner.getAllMethodNames(instance).forEach((methodName) => {
        const methodRef = instance[methodName] as object;
        const methodMetaKeys = Reflect.getOwnMetadataKeys(methodRef);

        if (methodMetaKeys.includes(MCP_TOOL_METADATA_KEY)) {
          this.addDiscoveryTool(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }

        if (methodMetaKeys.includes(MCP_RESOURCE_METADATA_KEY)) {
          this.addDiscoveryResource(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }

        if (methodMetaKeys.includes(MCP_RESOURCE_TEMPLATE_METADATA_KEY)) {
          this.addDiscoveryResourceTemplate(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }

        if (methodMetaKeys.includes(MCP_PROMPT_METADATA_KEY)) {
          this.addDiscoveryPrompt(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }
      });
    }
  }

  /**
   * Scans all providers and controllers for @Tool decorators
   */
  private discoverToolsForModuleSubtree(
    mcpModuleId: string,
    modules: Module[],
  ) {
    const providers = this.discovery.getProviders(undefined, modules);
    const controllers = this.discovery.getControllers(undefined, modules);
    const allInstances = [...providers, ...controllers]
      .filter(
        (wrapper) =>
          wrapper.instance &&
          typeof wrapper.instance === 'object' &&
          wrapper.instance !== null,
      )
      .map((wrapper) => ({
        instance: wrapper.instance as object,
        token: wrapper.token,
      }));

    allInstances.forEach(({ instance, token }) => {
      this.metadataScanner.getAllMethodNames(instance).forEach((methodName) => {
        const methodRef = instance[methodName] as object;
        const methodMetaKeys = Reflect.getOwnMetadataKeys(methodRef);

        if (methodMetaKeys.includes(MCP_TOOL_METADATA_KEY)) {
          this.addDiscoveryTool(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }

        if (methodMetaKeys.includes(MCP_RESOURCE_METADATA_KEY)) {
          this.addDiscoveryResource(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }

        if (methodMetaKeys.includes(MCP_RESOURCE_TEMPLATE_METADATA_KEY)) {
          this.addDiscoveryResourceTemplate(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }

        if (methodMetaKeys.includes(MCP_PROMPT_METADATA_KEY)) {
          this.addDiscoveryPrompt(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }
      });
    });
  }

  /**
   * Adds a discovered tool to the registry
   */
  private addDiscovery<T>(
    type: 'tool' | 'resource' | 'resource-template' | 'prompt',
    metadataKey: string,
    mcpModuleId: string,
    methodRef: object,
    token: InjectionTokenWithName,
    methodName: string,
  ) {
    const metadata: T = Reflect.getMetadata(metadataKey, methodRef);

    if (!metadata['name']) {
      metadata['name'] = methodName;
    }

    if (!this.discoveredToolsByMcpModuleId.has(mcpModuleId)) {
      this.discoveredToolsByMcpModuleId.set(mcpModuleId, []);
    }

    this.discoveredToolsByMcpModuleId.get(mcpModuleId)?.push({
      type,
      metadata,
      providerClass: token,
      methodName,
    });
  }

  private addDiscoveryPrompt(
    mcpModuleId: string,
    methodRef: object,
    token: InjectionTokenWithName,
    methodName: string,
  ) {
    this.logger.debug(
      `Prompt discovered: ${token.name}.${methodName} in module: ${mcpModuleId}`,
    );
    this.addDiscovery<PromptMetadata>(
      'prompt',
      MCP_PROMPT_METADATA_KEY,
      mcpModuleId,
      methodRef,
      token,
      methodName,
    );
  }

  private addDiscoveryTool(
    mcpModuleId: string,
    methodRef: object,
    token: InjectionTokenWithName,
    methodName: string,
  ) {
    this.logger.debug(
      `Tool discovered: ${token.name}.${methodName} in module: ${mcpModuleId}`,
    );

    // Collect security metadata from decorators
    const isPublic = Reflect.getMetadata(MCP_PUBLIC_METADATA_KEY, methodRef);
    const requiredScopes = Reflect.getMetadata(
      MCP_SCOPES_METADATA_KEY,
      methodRef,
    );
    const requiredRoles = Reflect.getMetadata(
      MCP_ROLES_METADATA_KEY,
      methodRef,
    );

    // Add tool with security metadata
    const baseMetadata: ToolMetadata = Reflect.getMetadata(
      MCP_TOOL_METADATA_KEY,
      methodRef,
    );

    if (!baseMetadata.name) {
      baseMetadata.name = methodName;
    }

    // Enrich with security metadata
    if (isPublic !== undefined) {
      baseMetadata.isPublic = isPublic;
    }
    if (requiredScopes) {
      baseMetadata.requiredScopes = requiredScopes;
    }
    if (requiredRoles) {
      baseMetadata.requiredRoles = requiredRoles;
    }

    if (!this.discoveredToolsByMcpModuleId.has(mcpModuleId)) {
      this.discoveredToolsByMcpModuleId.set(mcpModuleId, []);
    }

    this.discoveredToolsByMcpModuleId.get(mcpModuleId)?.push({
      type: 'tool',
      metadata: baseMetadata,
      providerClass: token,
      methodName,
    });
  }

  private addDiscoveryResource(
    mcpModuleId: string,
    methodRef: object,
    token: InjectionTokenWithName,
    methodName: string,
  ) {
    this.logger.debug(
      `Resource discovered: ${token.name}.${methodName} in module: ${mcpModuleId}`,
    );
    this.addDiscovery<ResourceMetadata>(
      'resource',
      MCP_RESOURCE_METADATA_KEY,
      mcpModuleId,
      methodRef,
      token,
      methodName,
    );
  }

  private addDiscoveryResourceTemplate(
    mcpModuleId: string,
    methodRef: object,
    token: InjectionTokenWithName,
    methodName: string,
  ) {
    this.logger.debug(
      `Resource Template discovered: ${token.name}.${methodName} in module: ${mcpModuleId}`,
    );
    this.addDiscovery<ResourceTemplateMetadata>(
      'resource-template',
      MCP_RESOURCE_TEMPLATE_METADATA_KEY,
      mcpModuleId,
      methodRef,
      token,
      methodName,
    );
  }

  /**
   * Return all discovered MCP module IDs
   */
  getMcpModuleIds(): string[] {
    return Array.from(this.discoveredToolsByMcpModuleId.keys());
  }

  /**
   * Get all discovered tools
   */
  getTools(mcpModuleId: string): DiscoveredTool<ToolMetadata>[] {
    return (
      this.discoveredToolsByMcpModuleId
        .get(mcpModuleId)
        ?.filter((tool) => tool.type === 'tool') ?? []
    );
  }

  /**
   * Find a tool by name
   */
  findTool(
    mcpModuleId: string,
    name: string,
  ): DiscoveredTool<ToolMetadata> | undefined {
    return this.getTools(mcpModuleId).find(
      (tool) => tool.metadata.name === name,
    );
  }

  /**
   * Get all discovered resources
   */
  getResources(mcpModuleId: string): DiscoveredTool<ResourceMetadata>[] {
    return (
      this.discoveredToolsByMcpModuleId
        .get(mcpModuleId)
        ?.filter((tool) => tool.type === 'resource') ?? []
    );
  }

  /**
   * Find a resource by name
   */
  findResource(
    mcpModuleId: string,
    name: string,
  ): DiscoveredTool<ResourceMetadata> | undefined {
    return this.getResources(mcpModuleId).find(
      (tool) => tool.metadata.name === name,
    );
  }

  /**
   * Get all discovered resource templates
   */
  getResourceTemplates(
    mcpModuleId: string,
  ): DiscoveredTool<ResourceTemplateMetadata>[] {
    return (
      this.discoveredToolsByMcpModuleId
        .get(mcpModuleId)
        ?.filter((tool) => tool.type === 'resource-template') ?? []
    );
  }

  /**
   * Find a resource by name
   */
  findResourceTemplate(
    mcpModuleId: string,
    name: string,
  ): DiscoveredTool<ResourceTemplateMetadata> | undefined {
    return this.getResourceTemplates(mcpModuleId).find(
      (tool) => tool.metadata.name === name,
    );
  }

  /**
   * Get all discovered prompts
   */
  getPrompts(mcpModuleId: string): DiscoveredTool<PromptMetadata>[] {
    return (
      this.discoveredToolsByMcpModuleId
        .get(mcpModuleId)
        ?.filter((tool) => tool.type === 'prompt') ?? []
    );
  }

  /**
   * Find a prompt by name
   */
  findPrompt(
    mcpModuleId: string,
    name: string,
  ): DiscoveredTool<PromptMetadata> | undefined {
    return this.getPrompts(mcpModuleId).find(
      (tool) => tool.metadata.name === name,
    );
  }

  /**
   * Convert RFC 6570 URI template to path-to-regexp compatible format.
   * Handles both path parameters {param} and query parameters {?param} or {?param1,param2}
   */
  private convertTemplate(template: string): string {
    if (!template) return template;

    // Remove RFC 6570 query parameter syntax {?...} from the template
    // These will be handled separately via URL query string parsing
    const withoutQueryParams = template.replace(/\{\?[^}]+\}/g, '');

    // Convert path parameters {param} to path-to-regexp format :param
    return withoutQueryParams.replace(/{(\w+)}/g, ':$1');
  }

  /**
   * Extract query parameter names from an RFC 6570 URI template.
   * E.g., 'mcp://example{?foo,bar}' returns ['foo', 'bar']
   */
  private extractTemplateQueryParams(template: string): string[] {
    const queryParamMatch = template.match(/\{\?([^}]+)\}/);
    if (!queryParamMatch) return [];
    return queryParamMatch[1].split(',').map((p) => p.trim());
  }

  /**
   * Parse query string from a URI and return as key-value pairs.
   */
  private parseQueryString(uri: string): Record<string, string> {
    const queryIndex = uri.indexOf('?');
    if (queryIndex === -1) return {};

    const queryString = uri.substring(queryIndex + 1);
    const params: Record<string, string> = {};

    for (const pair of queryString.split('&')) {
      const [key, value] = pair.split('=');
      if (key) {
        params[decodeURIComponent(key)] = value
          ? decodeURIComponent(value)
          : '';
      }
    }

    return params;
  }

  /**
   * Strip query string from a URI, returning only the path portion.
   */
  private stripQueryString(uri: string): string {
    const queryIndex = uri.indexOf('?');
    return queryIndex === -1 ? uri : uri.substring(0, queryIndex);
  }

  private convertUri(uri: string): string {
    if (uri.includes('://')) {
      return uri.split('://')[1];
    }

    return uri;
  }

  /**
   * Find a resource by uri
   * @returns An object containing the found resource and extracted parameters, or undefined if no resource is found
   */
  findResourceByUri(
    mcpModuleId: string,
    uri: string,
  ):
    | {
        resource: DiscoveredTool<ResourceMetadata>;
        params: Record<string, string>;
      }
    | undefined {
    const resources = this.getResources(mcpModuleId).map((tool) => ({
      name: tool.metadata.name,
      uri: tool.metadata.uri,
    }));

    const strippedInputUri = this.convertUri(uri);

    for (const t of resources) {
      if (!t.uri) continue;

      const rawTemplate = t.uri;
      const templatePath = this.convertTemplate(this.convertUri(rawTemplate));
      const matcher = match(templatePath, { decode: decodeURIComponent });
      const result = matcher(strippedInputUri);

      if (result) {
        const foundResource = this.findResource(mcpModuleId, t.name);
        if (!foundResource) continue;

        return {
          resource: foundResource,
          params: result.params as Record<string, string>,
        };
      }
    }

    return undefined;
  }

  /**
   * Find a resource template by uri
   * @returns An object containing the found resource template and extracted parameters, or undefined if no resource template is found
   */
  findResourceTemplateByUri(
    mcpModuleId: string,
    uri: string,
  ):
    | {
        resourceTemplate: DiscoveredTool<ResourceTemplateMetadata>;
        params: Record<string, string>;
      }
    | undefined {
    const resourceTemplates = this.getResourceTemplates(mcpModuleId).map(
      (tool) => ({
        name: tool.metadata.name,
        uriTemplate: tool.metadata.uriTemplate,
      }),
    );

    // Strip query string from input URI for path matching
    const strippedInputUri = this.stripQueryString(this.convertUri(uri));
    // Parse query parameters from input URI
    const inputQueryParams = this.parseQueryString(uri);

    for (const t of resourceTemplates) {
      if (!t.uriTemplate) continue;

      const rawTemplate = t.uriTemplate;
      // Convert template (removes {?...} query params and converts {param} to :param)
      const templatePath = this.convertTemplate(this.convertUri(rawTemplate));
      const matcher = match(templatePath, { decode: decodeURIComponent });
      const result = matcher(strippedInputUri);

      if (result) {
        const foundResourceTemplate = this.findResourceTemplate(
          mcpModuleId,
          t.name,
        );
        if (!foundResourceTemplate) continue;

        // Get path params from matching
        const pathParams = result.params as Record<string, string>;

        // Get expected query params from template and filter input query params
        const expectedQueryParams =
          this.extractTemplateQueryParams(rawTemplate);
        const queryParams: Record<string, string> = {};
        for (const paramName of expectedQueryParams) {
          if (inputQueryParams[paramName] !== undefined) {
            queryParams[paramName] = inputQueryParams[paramName];
          }
        }

        return {
          resourceTemplate: foundResourceTemplate,
          params: { ...pathParams, ...queryParams },
        };
      }
    }

    return undefined;
  }

  /**
   * Register a tool programmatically (for dynamic tools).
   * Use McpToolBuilder.registerTool() instead of calling this directly.
   *
   * @param mcpModuleId - The module ID to register the tool with
   * @param tool - The discovered tool object to register
   */
  registerDynamicTool(
    mcpModuleId: string,
    tool: DiscoveredTool<ToolMetadata>,
  ): void {
    if (!this.discoveredToolsByMcpModuleId.has(mcpModuleId)) {
      this.discoveredToolsByMcpModuleId.set(mcpModuleId, []);
    }

    this.logger.debug(
      `Dynamic tool registered: ${tool.metadata.name} in module: ${mcpModuleId}`,
    );

    this.discoveredToolsByMcpModuleId.get(mcpModuleId)?.push(tool);
  }
}
