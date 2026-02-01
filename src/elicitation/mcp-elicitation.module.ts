import { DynamicModule, Module } from '@nestjs/common';
import type {
  ElicitationModuleOptions,
  ResolvedElicitationOptions,
} from './interfaces/elicitation-options.interface';
import { DEFAULT_ELICITATION_OPTIONS } from './interfaces/elicitation-options.interface';
import { ELICITATION_STORE_TOKEN } from './interfaces/elicitation-store.interface';
import { MemoryElicitationStore } from './stores/memory-elicitation.store';
import {
  ElicitationService,
  ELICITATION_MODULE_OPTIONS,
  COMPLETION_NOTIFIER_REGISTRY,
  type CompletionNotifierRegistry,
} from './services/elicitation.service';
import { createElicitationController } from './elicitation.controller';
import { normalizeEndpoint } from '../mcp/utils/normalize-endpoint';

let elicitationInstanceIdCounter = 0;

@Module({})
export class McpElicitationModule {
  /**
   * Marker property to identify this module type.
   */
  readonly __isMcpElicitationModule = true;

  /**
   * Configure the elicitation module.
   *
   * @param options - Module configuration options
   * @returns Dynamic module configuration
   *
   * @example
   * ```typescript
   * McpElicitationModule.forRoot({
   *   serverUrl: 'http://localhost:3000',
   *   apiPrefix: 'elicit',
   * })
   * ```
   */
  static forRoot(options: ElicitationModuleOptions): DynamicModule {
    // Create unique instance ID for module isolation
    const moduleId = `elicitation-module-${elicitationInstanceIdCounter++}`;

    // Resolve options with defaults
    const resolvedOptions = this.resolveOptions(options);

    // Prepare endpoints with API prefix
    resolvedOptions.endpoints = this.prepareEndpoints(
      resolvedOptions.apiPrefix,
      resolvedOptions.endpoints,
    );

    // Create instance-scoped tokens
    const optionsToken = `${ELICITATION_MODULE_OPTIONS}_${moduleId}`;
    const storeToken = `${ELICITATION_STORE_TOKEN}_${moduleId}`;
    const serviceToken = `ElicitationService_${moduleId}`;
    const notifierRegistryToken = `${COMPLETION_NOTIFIER_REGISTRY}_${moduleId}`;

    // Create notifier registry instance
    const notifierRegistry: CompletionNotifierRegistry = new Map();

    // Create store provider based on configuration
    const storeProvider = this.createStoreProvider(
      resolvedOptions.storeConfiguration,
      storeToken,
    );

    // Create controller with configured endpoints
    const ControllerClass = createElicitationController(
      resolvedOptions.endpoints,
      moduleId,
    );

    // Update controller path based on apiPrefix
    Reflect.defineMetadata('path', resolvedOptions.apiPrefix, ControllerClass);

    const providers: any[] = [
      // Module ID for reference
      {
        provide: 'ELICITATION_MODULE_ID',
        useValue: moduleId,
      },
      // Options provider (instance-scoped)
      {
        provide: optionsToken,
        useValue: resolvedOptions,
      },
      // Backward-compatible options alias
      {
        provide: ELICITATION_MODULE_OPTIONS,
        useExisting: optionsToken,
      },
      // Store provider
      storeProvider,
      // Backward-compatible store alias
      {
        provide: ELICITATION_STORE_TOKEN,
        useExisting: storeToken,
      },
      // Notifier registry provider (instance-scoped)
      {
        provide: notifierRegistryToken,
        useValue: notifierRegistry,
      },
      // Backward-compatible notifier registry alias
      {
        provide: COMPLETION_NOTIFIER_REGISTRY,
        useExisting: notifierRegistryToken,
      },
      // Service provider (instance-scoped)
      {
        provide: serviceToken,
        useFactory: (
          store: MemoryElicitationStore,
          opts: ResolvedElicitationOptions,
          registry: CompletionNotifierRegistry,
        ) => {
          return new ElicitationService(store, opts, registry);
        },
        inject: [storeToken, optionsToken, notifierRegistryToken],
      },
      // Backward-compatible service alias
      {
        provide: ElicitationService,
        useExisting: serviceToken,
      },
    ];

    return {
      module: McpElicitationModule,
      global: true, // Make exports available to all modules (needed for McpToolsHandler injection)
      controllers: [ControllerClass],
      providers,
      exports: [
        'ELICITATION_MODULE_ID',
        ELICITATION_MODULE_OPTIONS,
        ELICITATION_STORE_TOKEN,
        COMPLETION_NOTIFIER_REGISTRY,
        ElicitationService,
      ],
    };
  }

  /**
   * Resolve options by merging with defaults.
   */
  private static resolveOptions(
    options: ElicitationModuleOptions,
  ): ResolvedElicitationOptions {
    // Validate required options
    if (!options.serverUrl) {
      throw new Error('ElicitationModuleOptions: serverUrl is required');
    }

    // Validate serverUrl is a valid URL
    try {
      new URL(options.serverUrl);
    } catch {
      throw new Error('ElicitationModuleOptions: serverUrl must be a valid URL');
    }

    return {
      serverUrl: options.serverUrl,
      apiPrefix: options.apiPrefix ?? DEFAULT_ELICITATION_OPTIONS.apiPrefix,
      elicitationTtlMs: options.elicitationTtlMs ?? DEFAULT_ELICITATION_OPTIONS.elicitationTtlMs,
      cleanupIntervalMs: options.cleanupIntervalMs ?? DEFAULT_ELICITATION_OPTIONS.cleanupIntervalMs,
      storeConfiguration: options.storeConfiguration ?? DEFAULT_ELICITATION_OPTIONS.storeConfiguration,
      endpoints: {
        ...DEFAULT_ELICITATION_OPTIONS.endpoints,
        ...options.endpoints,
      },
      guards: options.guards,
      templateOptions: {
        ...DEFAULT_ELICITATION_OPTIONS.templateOptions,
        ...options.templateOptions,
      },
    };
  }

  /**
   * Prepare endpoints with API prefix normalization.
   */
  private static prepareEndpoints(
    apiPrefix: string,
    endpoints: ResolvedElicitationOptions['endpoints'],
  ): ResolvedElicitationOptions['endpoints'] {
    return {
      status: endpoints.status,
      complete: endpoints.complete,
      apiKey: endpoints.apiKey,
      confirm: endpoints.confirm,
    };
  }

  /**
   * Create store provider based on configuration.
   */
  private static createStoreProvider(
    storeConfiguration: ResolvedElicitationOptions['storeConfiguration'],
    provideToken: string,
  ) {
    if (!storeConfiguration || storeConfiguration.type === 'memory') {
      return {
        provide: provideToken,
        useClass: MemoryElicitationStore,
      };
    }

    if (storeConfiguration.type === 'custom') {
      return {
        provide: provideToken,
        useValue: storeConfiguration.store,
      };
    }

    throw new Error(
      `Unknown store configuration type: ${(storeConfiguration as any).type}`,
    );
  }
}
