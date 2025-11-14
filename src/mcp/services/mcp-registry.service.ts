import {
  Inject,
  Injectable,
  InjectionToken,
  Logger,
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
  MCP_VALIDATION_ADAPTER,
  ToolMetadata,
} from '../decorators';
import { ResourceMetadata } from '../decorators/resource.decorator';
import { match } from 'path-to-regexp';
import { PromptMetadata } from '../decorators/prompt.decorator';
import { Module } from '@nestjs/core/injector/module';
import { ResourceTemplateMetadata } from '../decorators/resource-template.decorator';
import { IValidationAdapter } from '../interfaces';

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
export class McpRegistryService {
  private readonly logger = new Logger(McpRegistryService.name);
  private discoveredToolsByMcpModuleId: Map<string, DiscoveredTool<any>[]> =
    new Map();
  private readonly jsonSchemaCache: Map<any, any> = new Map();
  private readonly discoveryPromise: Promise<void>;

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
    private readonly modulesContainer: ModulesContainer,
    @Inject(MCP_VALIDATION_ADAPTER)
    private readonly validationAdapter: IValidationAdapter,
  ) {
    this.discoveryPromise = this.discoverTools();
  }

  whenReady(): Promise<void> {
    return this.discoveryPromise;
  }

  /**
   * Finds all modules that import the McpModule and then scans the providers and controllers in their subtrees
   */
  private async discoverTools() {
    // This is a workaround to ensure that the module graph is fully initialized
    // before we start discovering tools.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const getImportedMcpModules = (module: Module) =>
      Array.from(module.imports).filter(
        (m) => (m.instance as any)?.__isMcpModule,
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

      const subtreeModules = this.collectSubtreeModules(rootModule);

      for (const mcpModule of mcpModules) {
        const mcpModuleId =
          mcpModule.getProviderByKey<string>('MCP_MODULE_ID')?.instance;
        if (mcpModuleId) {
          await this.discoverToolsForModuleSubtree(mcpModuleId, subtreeModules);
        }
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
  private async discoverToolsForModuleSubtree(
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

    for (const { instance, token } of allInstances) {
      for (const methodName of this.metadataScanner.getAllMethodNames(
        instance,
      )) {
        const methodRef = instance[methodName] as object;
        const methodMetaKeys = Reflect.getOwnMetadataKeys(methodRef);

        if (methodMetaKeys.includes(MCP_TOOL_METADATA_KEY)) {
          await this.addDiscoveryTool(
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
          await this.addDiscoveryResourceTemplate(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }

        if (methodMetaKeys.includes(MCP_PROMPT_METADATA_KEY)) {
          await this.addDiscoveryPrompt(
            mcpModuleId,
            methodRef,
            token as InjectionTokenWithName,
            methodName,
          );
        }
      }
    }
  }

  /**
   * Adds a discovered tool to the registry
   */
  private async addDiscovery<T>(
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

    if (metadata['parameters']) {
      const schema = await this.validationAdapter.toJsonSchema(
        metadata['parameters'],
      );
      this.jsonSchemaCache.set(metadata['parameters'], schema);
    }
    if (metadata['outputSchema']) {
      const schema = await this.validationAdapter.toJsonSchema(
        metadata['outputSchema'],
      );
      this.jsonSchemaCache.set(metadata['outputSchema'], schema);
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

  private async addDiscoveryPrompt(
    mcpModuleId: string,
    methodRef: object,
    token: InjectionTokenWithName,
    methodName: string,
  ) {
    this.logger.debug(
      `Prompt discovered: ${token.name}.${methodName} in module: ${mcpModuleId}`,
    );
    await this.addDiscovery<PromptMetadata>(
      'prompt',
      MCP_PROMPT_METADATA_KEY,
      mcpModuleId,
      methodRef,
      token,
      methodName,
    );
  }

  private async addDiscoveryTool(
    mcpModuleId: string,
    methodRef: object,
    token: InjectionTokenWithName,
    methodName: string,
  ) {
    this.logger.debug(
      `Tool discovered: ${token.name}.${methodName} in module: ${mcpModuleId}`,
    );
    await this.addDiscovery<ToolMetadata>(
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

  private async addDiscoveryResourceTemplate(
    mcpModuleId: string,
    methodRef: object,
    token: InjectionTokenWithName,
    methodName: string,
  ) {
    this.logger.debug(
      `Resource Template discovered: ${token.name}.${methodName} in module: ${mcpModuleId}`,
    );
    await this.addDiscovery<ResourceTemplateMetadata>(
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

  getJsonSchema(schema: any): any {
    return this.jsonSchemaCache.get(schema);
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

    const strippedInputUri = this.convertUri(uri);

    for (const t of resourceTemplates) {
      if (!t.uriTemplate) continue;

      const rawTemplate = t.uriTemplate;
      const templatePath = this.convertTemplate(this.convertUri(rawTemplate));
      const matcher = match(templatePath, { decode: decodeURIComponent });
      const result = matcher(strippedInputUri);

      if (result) {
        const foundResourceTemplate = this.findResourceTemplate(
          mcpModuleId,
          t.name,
        );
        if (!foundResourceTemplate) continue;

        return {
          resourceTemplate: foundResourceTemplate,
          params: result.params as Record<string, string>,
        };
      }
    }

    return undefined;
  }
}
