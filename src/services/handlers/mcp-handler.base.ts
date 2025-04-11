import { Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  Progress,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Context, SerializableValue } from 'src/interfaces/mcp-tool.interface';
import { McpRegistryService } from '../mcp-registry.service';

export abstract class McpHandlerBase {
  protected logger: Logger;

  constructor(
    protected readonly moduleRef: ModuleRef,
    protected readonly registry: McpRegistryService,
    loggerContext: string,
  ) {
    this.logger = new Logger(loggerContext);
  }

  protected createContext(
    mcpServer: McpServer,
    mcpRequest: z.infer<
      | typeof CallToolRequestSchema
      | typeof ReadResourceRequestSchema
      | typeof GetPromptRequestSchema
    >,
  ): Context {
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
    };
  }
}
