// Main module
export { McpElicitationModule } from './mcp-elicitation.module';

// Interfaces
export type {
  Elicitation,
  ElicitationResult,
  CreateElicitationParams,
  CompleteElicitationParams,
} from './interfaces/elicitation.interface';

export type { IElicitationStore } from './interfaces/elicitation-store.interface';
export { ELICITATION_STORE_TOKEN } from './interfaces/elicitation-store.interface';

export type {
  ElicitationModuleOptions,
  ElicitationEndpointConfiguration,
  ElicitationStoreConfiguration,
  ElicitationTemplateOptions,
  ResolvedElicitationOptions,
} from './interfaces/elicitation-options.interface';
export { DEFAULT_ELICITATION_OPTIONS } from './interfaces/elicitation-options.interface';

// Services
export {
  ElicitationService,
  ELICITATION_MODULE_OPTIONS,
  COMPLETION_NOTIFIER_REGISTRY,
} from './services/elicitation.service';
export type { CompletionNotifier, CompletionNotifierRegistry } from './services/elicitation.service';

// Stores
export { MemoryElicitationStore } from './stores/memory-elicitation.store';

// Controller factory (for advanced usage)
export { createElicitationController } from './elicitation.controller';

// Templates (for customization)
export {
  baseTemplate,
  escapeHtml,
  apiKeyFormTemplate,
  confirmationFormTemplate,
  successPageTemplate,
  cancelledPageTemplate,
  errorPageTemplate,
} from './templates';
export type {
  BaseTemplateParams,
  ApiKeyFormParams,
  ConfirmationFormParams,
  SuccessPageParams,
  CancelledPageParams,
  ErrorPageParams,
} from './templates';
