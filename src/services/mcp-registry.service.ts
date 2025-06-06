import {
  Injectable,
  InjectionToken,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import {
  DiscoveryService,
  MetadataScanner,
  ModulesContainer,
} from '@nestjs/core';
import {
  MCP_PROMPT_METADATA_KEY,
  MCP_RESOURCE_METADATA_KEY,
  MCP_TOOL_METADATA_KEY,
  ToolMetadata,
} from '../decorators';
import { ResourceMetadata } from '../decorators/resource.decorator';
import { match } from 'path-to-regexp';
import { PromptMetadata } from '../decorators/prompt.decorator';
import { Module } from '@nestjs/core/injector/module';

/**
 * Interface representing a discovered tool
 */
export type DiscoveredTool<T extends object> = {
  type: 'tool' | 'resource' | 'prompt';
  metadata: T;
  providerClass: InjectionToken;
  methodName: string;
};

/**
 * Singleton service that discovers and registers tools during application bootstrap
 */
@Injectable()
export class McpRegistryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(McpRegistryService.name);
  private discoveredToolsByMcpModuleId: Map<string, DiscoveredTool<any>[]> =
    new Map();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly modulesContainer: ModulesContainer,
  ) {}

  onApplicationBootstrap() {
    this.discoverTools();
  }

  /**
   * Finds all modules that import the McpModule and then scans the providers and controllers in their subtrees
   */
  private discoverTools() {
    const getImportedMcpModules = (module: Module) =>
      Array.from(module.imports).filter(
        (m) => (m.instance as any).__isMcpModule,
      );

    const pairs = Array.from(this.modulesContainer.values())
      .map((module): [Module, Module[]] => [
        module,
        getImportedMcpModules(module),
      ])
      .filter(([, importedMcpModules]) => importedMcpModules.length > 0);

    for (const [rootModule, mcpModules] of pairs) {
      this.logger.debug(
        `Discovering tools, resources, and prompts for module: ${rootModule.name}`,
      );

      const subtreeModules = this.collectSubtreeModules(rootModule);

      for (const mcpModule of mcpModules) {
        const mcpModuleId =
          mcpModule.getProviderByKey<string>('MCP_MODULE_ID')?.instance;
        this.discoverToolsForModuleSubtree(mcpModuleId, subtreeModules);
      }
    }
  }

  private collectSubtreeModules(root: Module): Module[] {
    const subtreeModules: Module[] = [];
    const collect = (module: Module) => {
      subtreeModules.push(module);
      module.imports.forEach((importedModule) => {
        if (!subtreeModules.includes(importedModule)) {
          collect(importedModule);
        }
      });
    };
    collect(root);
    return subtreeModules;
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

    const discovered: {
      tools: string[];
      resources: string[];
      prompts: string[];
    } = { tools: [], resources: [], prompts: [] };

    allInstances.forEach(({ instance, token }) => {
      this.metadataScanner.getAllMethodNames(instance).forEach((methodName) => {
        const methodRef = instance[methodName] as object;
        const methodMetaKeys = Reflect.getOwnMetadataKeys(methodRef);

        if (methodMetaKeys.includes(MCP_TOOL_METADATA_KEY)) {
          this.addDiscoveryTool(mcpModuleId, methodRef, token, methodName);
          discovered.tools.push(`${token.toString()}.${methodName}`);
        }

        if (methodMetaKeys.includes(MCP_RESOURCE_METADATA_KEY)) {
          this.addDiscoveryResource(mcpModuleId, methodRef, token, methodName);
          discovered.resources.push(`${token.toString()}.${methodName}`);
        }

        if (methodMetaKeys.includes(MCP_PROMPT_METADATA_KEY)) {
          this.addDiscoveryPrompt(mcpModuleId, methodRef, token, methodName);
          discovered.prompts.push(`${token.toString()}.${methodName}`);
        }
      });
    });

    this.logger.debug(
      `Discovered tools: ${discovered.tools.length ? discovered.tools.join(', ') : 'none'}`,
    );
    this.logger.debug(
      `Discovered resources: ${discovered.resources.length ? discovered.resources.join(', ') : 'none'}`,
    );
    this.logger.debug(
      `Discovered prompts: ${discovered.prompts.length ? discovered.prompts.join(', ') : 'none'}`,
    );
  }

  /**
   * Adds a discovered tool to the registry
   */
  private addDiscovery<T>(
    type: 'tool' | 'resource' | 'prompt',
    metadataKey: string,
    mcpModuleId: string,
    methodRef: object,
    token: InjectionToken,
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
    token: InjectionToken,
    methodName: string,
  ) {
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
    token: InjectionToken,
    methodName: string,
  ) {
    this.addDiscovery<ToolMetadata>(
      'tool',
      MCP_TOOL_METADATA_KEY,
      mcpModuleId,
      methodRef,
      token,
      methodName,
    );
  }

  private addDiscoveryResource(
    mcpModuleId: string,
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    this.addDiscovery<ResourceMetadata>(
      'resource',
      MCP_RESOURCE_METADATA_KEY,
      mcpModuleId,
      methodRef,
      token,
      methodName,
    );
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

  private convertTemplate(template: string): string {
    return template?.replace(/{(\w+)}/g, ':$1');
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
}
