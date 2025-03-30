import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { MCP_CLEANUP_METADATA_KEY } from "../decorators";

export type CleanupContext = {
  sessionId: string;
}

@Injectable()
export class CleanupService implements OnApplicationBootstrap {
  private callbacks: Array<{
    instance: any;
    methodName: string;
  }> = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
  ) {}

  onApplicationBootstrap() {
    this.collectCallbacks();
  }

  collectCallbacks() {
    const providers = this.discovery.getProviders();
    const controllers = this.discovery.getControllers();
    const allInstances = [...providers, ...controllers]
      .filter((wrapper) => wrapper.instance)
      .map((wrapper) => wrapper.instance);

    allInstances.forEach((instance) => {
      if (!instance || typeof instance !== 'object') {
        return;
      }
      this.metadataScanner.getAllMethodNames(instance).forEach((methodName) => {
        const methodRef = instance[methodName];
        const methodMetaKeys = Reflect.getOwnMetadataKeys(methodRef);

        if (!methodMetaKeys.includes(MCP_CLEANUP_METADATA_KEY)) {
          return;
        }

        this.callbacks.push({
          instance,
          methodName,
        });
      });
    });
  }

  async cleanup(sessionId: string) {
    return Promise.allSettled(
      this.callbacks.map(
        async ({instance, methodName}) => instance[methodName].call(
          instance,
          {
            sessionId,
          },
        ),
      ),
    );
  }
}