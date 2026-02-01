import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Progress, UrlElicitationRequiredError } from '@modelcontextprotocol/sdk/types.js';
import type { ElicitRequestURLParams } from '@modelcontextprotocol/sdk/types.js';
import type {
  Context,
  McpRequest,
  SerializableValue,
  McpOptions,
  ElicitationContext,
  CreateUrlElicitationParams,
} from '../../interfaces';
import { McpRegistryService } from '../mcp-registry.service';
import { createMcpLogger } from '../../utils/mcp-logger.factory';
import type { ElicitationService } from '../../../elicitation/services/elicitation.service';

/**
 * Options for creating a context with elicitation support.
 */
export interface CreateContextOptions {
  /** User ID from authentication (for elicitation user binding) */
  userId?: string;
  /** Optional elicitation service (when McpElicitationModule is configured) */
  elicitationService?: ElicitationService;
}

export abstract class McpHandlerBase {
  protected logger: Logger;

  constructor(
    protected readonly moduleRef: ModuleRef,
    protected readonly registry: McpRegistryService,
    loggerContext: string,
    options?: McpOptions,
  ) {
    this.logger = createMcpLogger(loggerContext, options);
  }

  protected createContext(
    mcpServer: McpServer,
    mcpRequest: McpRequest,
    options?: CreateContextOptions,
  ): Context {
    // Handle stateless traffic where notifications and progress are not supported
    if ((mcpServer.server.transport as any).sessionId === undefined) {
      return this.createStatelessContext(mcpServer, mcpRequest, options);
    }

    const progressToken = mcpRequest.params?._meta?.progressToken;
    const context: Context = {
      reportProgress: async (progress: Progress) => {
        if (progressToken) {
          await mcpServer.server.notification({
            method: 'notifications/progress',
            params: {
              ...progress,
              progressToken,
            } as Progress,
          });
        }
      },
      log: {
        debug: (message: string, logContext?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'debug',
            data: { message, context: logContext },
          });
        },
        error: (message: string, logContext?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'error',
            data: { message, context: logContext },
          });
        },
        info: (message: string, logContext?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'info',
            data: { message, context: logContext },
          });
        },
        warn: (message: string, logContext?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'warning',
            data: { message, context: logContext },
          });
        },
      },
      mcpServer,
      mcpRequest,
    };

    // Add elicitation helpers if service is available
    if (options?.elicitationService) {
      context.elicitation = this.createElicitationContext(
        mcpServer,
        options.elicitationService,
        options.userId,
      );
    }

    return context;
  }

  protected createStatelessContext(
    mcpServer: McpServer,
    mcpRequest: McpRequest,
    options?: CreateContextOptions,
  ): Context {
    const warn = (fn: string) => {
      this.logger.warn(`Stateless context: '${fn}' is not supported.`);
    };
    const context: Context = {
      // eslint-disable-next-line @typescript-eslint/require-await,@typescript-eslint/no-unused-vars
      reportProgress: async (_progress: Progress) => {
        warn('reportProgress not supported in stateless');
      },
      log: {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        debug: (_message: string, _data?: SerializableValue) => {
          warn('server report logging not supported in stateless');
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        error: (_message: string, _data?: SerializableValue) => {
          warn('server report logging not supported in stateless');
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        info: (_message: string, _data?: SerializableValue) => {
          warn('server report logging not supported in stateless');
        },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        warn: (_message: string, _data?: SerializableValue) => {
          warn('server report logging not supported in stateless');
        },
      },
      mcpServer,
      mcpRequest,
    };

    // Add elicitation helpers if service is available (even for stateless)
    if (options?.elicitationService) {
      context.elicitation = this.createElicitationContext(
        mcpServer,
        options.elicitationService,
        options.userId,
      );
    }

    return context;
  }

  /**
   * Create the elicitation context helpers.
   */
  protected createElicitationContext(
    mcpServer: McpServer,
    elicitationService: ElicitationService,
    userId?: string,
  ): ElicitationContext {
    const sessionId = (mcpServer.server.transport as any).sessionId as string | undefined;

    return {
      createUrl: async (params: CreateUrlElicitationParams) => {
        if (!sessionId) {
          throw new Error('URL elicitation requires a session ID (stateful transport)');
        }

        // Create elicitation in the store
        const elicitationId = await elicitationService.createElicitation({
          sessionId,
          userId,
          metadata: {
            message: params.message,
            ...params.metadata,
          },
        });

        // Create completion notifier
        const completionNotifier = mcpServer.server.createElicitationCompletionNotifier(elicitationId);

        // Register the notifier for later use
        elicitationService.registerCompletionNotifier(elicitationId, completionNotifier);

        // Build the URL
        const url = elicitationService.buildElicitationUrl(elicitationId, params.path);

        return {
          elicitationId,
          url,
          completionNotifier,
        };
      },

      throwRequired: (elicitations: ElicitRequestURLParams[]): never => {
        throw new UrlElicitationRequiredError(elicitations);
      },

      isSupported: () => {
        const capabilities = mcpServer.server.getClientCapabilities();
        return !!(capabilities?.elicitation?.url);
      },

      getResult: async (elicitationId: string) => {
        return elicitationService.getResult(elicitationId);
      },

      findByUserAndType: async (lookupUserId: string, type: string) => {
        return elicitationService.findResultByUserAndType(lookupUserId, type);
      },

      elicitForm: async (params: { message: string; requestedSchema: object }) => {
        // Type assertion needed as the SDK has a very specific schema type
        return mcpServer.server.elicitInput({
          message: params.message,
          requestedSchema: params.requestedSchema as any,
        });
      },
    };
  }
}
