import { ExceptionFilter, Logger, Type } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolResult,
  McpError,
  Progress,
  ErrorCode,
} from '@modelcontextprotocol/sdk/types.js';
import {
  Context,
  McpRequest,
  SerializableValue,
  HttpRequest,
} from '../../interfaces';
import { McpOptions } from '../../interfaces/mcp-options.interface';
import { DiscoveredTool, McpRegistryService } from '../mcp-registry.service';
import { createMcpLogger } from '../../utils/mcp-logger.factory';
import {
  EXCEPTION_FILTERS_METADATA,
  FILTER_CATCH_EXCEPTIONS,
} from '@nestjs/common/constants';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';

export abstract class McpHandlerBase {
  protected logger: Logger;

  protected constructor(
    protected readonly moduleRef: ModuleRef,
    protected readonly registry: McpRegistryService,
    private readonly reflector: Reflector,
    loggerContext: string,
    options?: McpOptions,
  ) {
    this.logger = createMcpLogger(loggerContext, options);
  }

  protected createContext(
    mcpServer: McpServer,
    mcpRequest: McpRequest,
  ): Context {
    // handless stateless traffic where notifications and progress are not supported
    if ((mcpServer.server.transport as any).sessionId === undefined) {
      return this.createStatelessContext(mcpServer, mcpRequest);
    }

    const progressToken = mcpRequest.params?._meta?.progressToken;
    return {
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
        debug: (message: string, context?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'debug',
            data: { message, context },
          });
        },
        error: (message: string, context?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'error',
            data: { message, context },
          });
        },
        info: (message: string, context?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'info',
            data: { message, context },
          });
        },
        warn: (message: string, context?: SerializableValue) => {
          void mcpServer.server.sendLoggingMessage({
            level: 'warning',
            data: { message, context },
          });
        },
      },
      mcpServer,
      mcpRequest,
    };
  }

  protected createStatelessContext(
    mcpServer: McpServer,
    mcpRequest: McpRequest,
  ): Context {
    const warn = (fn: string) => {
      this.logger.warn(`Stateless context: '${fn}' is not supported.`);
    };
    return {
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
  }

  protected createErrorResponse(errorText: string): CallToolResult | never {
    throw new McpError(ErrorCode.InternalError, errorText);
  }

  protected handleError(
    error: Error,
    capabilityInfo: DiscoveredTool<object>,
    httpRequest: HttpRequest,
  ) {
    this.logger.error(error);

    // Re-throw McpErrors (like validation errors) so they are handled by the MCP protocol layer
    if (error instanceof McpError) {
      throw error;
    }

    const clazz = capabilityInfo.providerClass as new () => unknown;
    const method = clazz.prototype[capabilityInfo.methodName] as (
      ...args: unknown[]
    ) => unknown;

    const methodFilters =
      this.reflector.get<Type<ExceptionFilter>[]>(
        EXCEPTION_FILTERS_METADATA,
        method,
      ) ?? [];

    const classFilters =
      this.reflector.get<Type<ExceptionFilter>[]>(
        EXCEPTION_FILTERS_METADATA,
        clazz,
      ) ?? [];

    const allFilters = [...methodFilters, ...classFilters];

    for (const FilterClass of allFilters) {
      if (this.isExceptionFiltered(error, FilterClass)) {
        const filterInstance = new FilterClass();
        const host = new ExecutionContextHost(
          [httpRequest.raw],
          capabilityInfo.providerClass as Type,
          method,
        );
        host.setType('http');
        const result = filterInstance.catch(error, host);

        const text =
          typeof result === 'string' ? result : JSON.stringify(result);

        return this.createErrorResponse(text);
      }
    }

    return this.createErrorResponse(error.message);
  }

  private getExceptionTypes(filter: Type<ExceptionFilter>): Type<Error>[] {
    return (
      this.reflector.get<Type<Error>[]>(FILTER_CATCH_EXCEPTIONS, filter) ?? []
    );
  }

  private isExceptionFiltered(
    error: Error,
    filter: Type<ExceptionFilter>,
  ): boolean {
    const exceptionTypes = this.getExceptionTypes(filter);

    if (exceptionTypes.length === 0) {
      return true;
    }

    return exceptionTypes.some((type) => error instanceof type);
  }
}
