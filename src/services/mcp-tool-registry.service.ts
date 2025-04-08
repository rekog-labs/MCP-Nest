import {
  Injectable,
  InjectionToken,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { MCP_TOOL_METADATA_KEY, ToolMetadata } from '../decorators';

/**
 * Interface representing a discovered tool
 */
export interface DiscoveredTool {
  metadata: ToolMetadata;
  providerClass: InjectionToken;
  methodName: string;
}

/**
 * Singleton service that discovers and registers tools during application bootstrap
 */
@Injectable()
export class McpToolRegistryService implements OnApplicationBootstrap {
  private discoveredTools: DiscoveredTool[] = [];

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

        if (!methodMetaKeys.includes(MCP_TOOL_METADATA_KEY)) {
          return;
        }

        const metadata: ToolMetadata = Reflect.getMetadata(
          MCP_TOOL_METADATA_KEY,
          methodRef,
        );

        this.discoveredTools.push({
          metadata,
          providerClass: token,
          methodName,
        });
      });
    });
  }

  /**
   * Get all discovered tools
   */
  getTools(): DiscoveredTool[] {
    return this.discoveredTools;
  }

  /**
   * Find a tool by name
   */
  findTool(name: string): DiscoveredTool | undefined {
    return this.discoveredTools.find((tool) => tool.metadata.name === name);
  }
}
