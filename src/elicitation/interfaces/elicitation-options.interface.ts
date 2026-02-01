import type { CanActivate, Type } from '@nestjs/common';
import type { IElicitationStore } from './elicitation-store.interface';

/**
 * Endpoint configuration for the elicitation controller.
 */
export interface ElicitationEndpointConfiguration {
  /** Status check endpoint (default: /status) */
  status?: string;

  /** Completion endpoint (default: /complete) */
  complete?: string;

  /** API key form endpoint (default: /api-key) */
  apiKey?: string;

  /** Confirmation page endpoint (default: /confirm) */
  confirm?: string;
}

/**
 * Template customization options.
 */
export interface ElicitationTemplateOptions {
  /** Custom CSS to inject into templates */
  customCss?: string;

  /** Logo URL to display in templates */
  logoUrl?: string;

  /** Application name to display */
  appName?: string;

  /** Primary color for buttons and accents (CSS color value) */
  primaryColor?: string;
}

/**
 * Store configuration options.
 */
export type ElicitationStoreConfiguration =
  | { type: 'memory' }
  | { type: 'custom'; store: IElicitationStore };

/**
 * Options for McpElicitationModule.forRoot().
 */
export interface ElicitationModuleOptions {
  /**
   * Base URL of the server (used for building elicitation URLs).
   * Example: 'http://localhost:3000'
   */
  serverUrl: string;

  /**
   * API prefix for elicitation endpoints.
   * Example: 'elicit' results in '/elicit/:id/api-key'
   * Default: 'elicitation'
   */
  apiPrefix?: string;

  /**
   * Time-to-live for elicitations in milliseconds.
   * Default: 3600000 (1 hour)
   */
  elicitationTtlMs?: number;

  /**
   * Interval for cleaning up expired elicitations in milliseconds.
   * Default: 600000 (10 minutes)
   */
  cleanupIntervalMs?: number;

  /**
   * Store configuration.
   * Default: { type: 'memory' }
   */
  storeConfiguration?: ElicitationStoreConfiguration;

  /**
   * Custom endpoint paths.
   */
  endpoints?: ElicitationEndpointConfiguration;

  /**
   * Guards to apply to elicitation endpoints.
   * Useful for integrating with McpAuthModule.
   */
  guards?: Type<CanActivate>[];

  /**
   * Template customization options.
   */
  templateOptions?: ElicitationTemplateOptions;
}

/**
 * Resolved options with defaults applied.
 */
export interface ResolvedElicitationOptions
  extends Required<
    Omit<ElicitationModuleOptions, 'guards' | 'storeConfiguration'>
  > {
  guards?: Type<CanActivate>[];
  storeConfiguration: ElicitationStoreConfiguration;
}

/**
 * Default configuration values.
 */
export const DEFAULT_ELICITATION_OPTIONS: Omit<
  ResolvedElicitationOptions,
  'serverUrl'
> = {
  apiPrefix: 'elicitation',
  elicitationTtlMs: 60 * 60 * 1000, // 1 hour
  cleanupIntervalMs: 10 * 60 * 1000, // 10 minutes
  storeConfiguration: { type: 'memory' },
  endpoints: {
    status: '/status',
    complete: '/complete',
    apiKey: '/api-key',
    confirm: '/confirm',
  },
  templateOptions: {
    appName: 'MCP Server',
    primaryColor: '#007bff',
  },
};
