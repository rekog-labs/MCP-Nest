import {
  Injectable,
  InjectionToken,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import {
  MCP_PROMPT_METADATA_KEY,
  MCP_RESOURCE_METADATA_KEY,
  MCP_TOOL_METADATA_KEY,
  ToolMetadata,
} from '../decorators';
import { ResourceMetadata } from 'src/decorators/resource.decorator';
import { match } from 'path-to-regexp';
import { PromptMetadata } from 'src/decorators/prompt.decorator';

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
  private discoveredTools: DiscoveredTool<any>[] = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
  ) {}

  onApplicationBootstrap() {
    this.discoverTools();
  }

  /**
   * Scans all providers and controllers for @Tool decorators
   */
  private discoverTools() {
    const providers = this.discovery.getProviders();
    const controllers = this.discovery.getControllers();
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
          this.addDiscoveryTool(methodRef, token, methodName);
        }

        if (methodMetaKeys.includes(MCP_RESOURCE_METADATA_KEY)) {
          this.addDiscoveryResource(methodRef, token, methodName);
        }

        if (methodMetaKeys.includes(MCP_PROMPT_METADATA_KEY)) {
          this.addDiscoveryPrompt(methodRef, token, methodName);
        }
      });
    });
  }

  /**
   * Adds a discovered tool to the registry
   */
  private addDiscovery<T>(
    type: 'tool' | 'resource' | 'prompt',
    metadataKey: string,
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    const metadata: T = Reflect.getMetadata(metadataKey, methodRef);

    this.discoveredTools.push({
      type,
      metadata,
      providerClass: token,
      methodName,
    });
  }

  private addDiscoveryPrompt(
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    this.addDiscovery<PromptMetadata>(
      'prompt',
      MCP_PROMPT_METADATA_KEY,
      methodRef,
      token,
      methodName,
    );
  }

  private addDiscoveryTool(
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    this.addDiscovery<ToolMetadata>(
      'tool',
      MCP_TOOL_METADATA_KEY,
      methodRef,
      token,
      methodName,
    );
  }

  private addDiscoveryResource(
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    this.addDiscovery<ResourceMetadata>(
      'resource',
      MCP_RESOURCE_METADATA_KEY,
      methodRef,
      token,
      methodName,
    );
  }

  /**
   * Get all discovered tools
   */
  getTools(): DiscoveredTool<ToolMetadata>[] {
    return this.discoveredTools.filter((tool) => tool.type === 'tool');
  }

  /**
   * Find a tool by name
   */
  findTool(name: string): DiscoveredTool<ToolMetadata> | undefined {
    return this.getTools().find((tool) => tool.metadata.name === name);
  }

  /**
   * Get all discovered resources
   */
  getResources(): DiscoveredTool<ResourceMetadata>[] {
    return this.discoveredTools.filter((tool) => tool.type === 'resource');
  }

  /**
   * Find a resource by name
   */
  findResource(name: string): DiscoveredTool<ResourceMetadata> | undefined {
    return this.getResources().find((tool) => tool.metadata.name === name);
  }

  /**
   * Get all discovered prompts
   */
  getPrompts(): DiscoveredTool<PromptMetadata>[] {
    return this.discoveredTools.filter((tool) => tool.type === 'prompt');
  }

  /**
   * Find a prompt by name
   */
  findPrompt(name: string): DiscoveredTool<PromptMetadata> | undefined {
    return this.getPrompts().find((tool) => tool.metadata.name === name);
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
  findResourceByUri(uri: string):
    | {
        resource: DiscoveredTool<ResourceMetadata>;
        params: Record<string, string>;
      }
    | undefined {
    const resources = this.getResources().map((tool) => ({
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
        const foundResource = this.findResource(t.name);
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
