import {
  Injectable,
  InjectionToken,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import {
  MCP_RESOURCE_METADATA_KEY,
  MCP_TOOL_METADATA_KEY,
  ToolMetadata,
} from '../decorators';
import { ResourceMetadata } from 'src/decorators/resource.decorator';

/**
 * Interface representing a discovered tool
 */
export type DiscoveredTool<T extends object> = {
  type: 'tool' | 'resource';
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
      .filter((wrapper) => wrapper.instance)
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
      });
    });
  }

  private addDiscoveryTool(
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    const metadata: ToolMetadata = Reflect.getMetadata(
      MCP_TOOL_METADATA_KEY,
      methodRef,
    );

    this.discoveredTools.push({
      type: 'tool',
      metadata,
      providerClass: token,
      methodName,
    });
  }

  private addDiscoveryResource(
    methodRef: object,
    token: InjectionToken,
    methodName: string,
  ) {
    const metadata: ResourceMetadata = Reflect.getMetadata(
      MCP_RESOURCE_METADATA_KEY,
      methodRef,
    );

    this.discoveredTools.push({
      type: 'resource',
      metadata,
      providerClass: token,
      methodName,
    });
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
   * Find a resource by uri
   */
  findResourceByUri(uri: string): DiscoveredTool<ResourceMetadata> | undefined {
    return this.getResources().find((tool) => tool.metadata.uri === uri);
  }
}
