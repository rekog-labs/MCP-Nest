import { InjectionToken } from '@nestjs/common';

/**
 * Token prefix for feature registrations.
 * Each McpModule.forFeature() call creates a unique provider with this prefix.
 */
export const MCP_FEATURE_REGISTRATION = 'MCP_FEATURE_REGISTRATION';

/**
 * Interface for feature registration metadata.
 * Used to map provider tokens to specific MCP server names.
 */
export interface McpFeatureRegistration {
  /**
   * The name of the MCP server this feature should register to.
   * Must match the `name` in a McpModule.forRoot() configuration.
   */
  serverName: string;

  /**
   * Provider tokens (class constructors or injection tokens) to scan for tools/resources/prompts.
   */
  providerTokens: InjectionToken[];
}
