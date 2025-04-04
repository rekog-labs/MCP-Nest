import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Injectable, Scope, Inject } from "@nestjs/common";
import { ModuleRef } from "@nestjs/core";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  Progress,
} from "@modelcontextprotocol/sdk/types.js";
import { REQUEST } from "@nestjs/core";
import { Request } from "express";
import { McpToolRegistryService } from "./mcp-tool-registry.service";

export type Literal = boolean | null | number | string | undefined;

export type SerializableValue =
  | Literal
  | SerializableValue[]
  | { [key: string]: SerializableValue };

export type TextContent = {
  type: "text";
  text: string;
};

export const TextContentZodSchema = z
  .object({
    type: z.literal("text"),
    /**
     * The text content of the message.
     */
    text: z.string(),
  })
  .strict() satisfies z.ZodType<TextContent>;

export type Content = TextContent;

export const ContentZodSchema = z.discriminatedUnion("type", [
  TextContentZodSchema,
]) satisfies z.ZodType<Content>;

export type ContentResult = {
  content: Content[];
  isError?: boolean;
};

export const ContentResultZodSchema = z
  .object({
    content: ContentZodSchema.array(),
    isError: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<ContentResult>;

/**
 * Enhanced execution context that includes user information
 */
export type Context = {
  user?: any;
  reportProgress: (progress: Progress) => Promise<void>;
  log: {
    debug: (message: string, data?: SerializableValue) => void;
    error: (message: string, data?: SerializableValue) => void;
    info: (message: string, data?: SerializableValue) => void;
    warn: (message: string, data?: SerializableValue) => void;
  };
};

class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

/**
 * Request-scoped service for executing MCP tools
 */
@Injectable({ scope: Scope.REQUEST })
export class McpToolsExecutorService {
  // Don't inject the request directly in the constructor
  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly toolRegistry: McpToolRegistryService
  ) {}

  /**
   * Register tool-related request handlers with the MCP server
   * @param mcpServer - The MCP server instance
   * @param request - The current HTTP request object
   */
  registerRequestHandlers(
    mcpServer: McpServer,
    httpRequest: Request & { user: any }
  ) {
    mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = this.toolRegistry.getTools().map((tool) => ({
        name: tool.metadata.name,
        description: tool.metadata.description,
        inputSchema: tool.metadata.parameters
          ? zodToJsonSchema(tool.metadata.parameters)
          : undefined,
      }));

      return {
        tools,
      };
    });

    // Register call tool handler
    mcpServer.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const toolInfo = this.toolRegistry.findTool(request.params.name);

        if (!toolInfo) {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
        }

        const schema = toolInfo.metadata.parameters;
        let parsedParams = request.params.arguments;

        if (schema && schema instanceof z.ZodType) {
          const result = schema.safeParse(request.params.arguments);
          if (!result.success) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `Invalid ${request.params.name} parameters: ${JSON.stringify(
                result.error.format()
              )}`
            );
          }
          parsedParams = result.data;
        }

        try {
          // Resolve the tool instance for the current request
          const toolInstance = await this.moduleRef.resolve(
            toolInfo.providerClass,
            undefined,
            { strict: false }
          );

          // Create the execution context with user information
          const context = this.createContext(mcpServer, request, httpRequest);

          // Call the tool method
          const result = await toolInstance[toolInfo.methodName].call(
            toolInstance,
            parsedParams,
            context,
            httpRequest
          );

          // Handle different result types
          if (typeof result === "string") {
            return ContentResultZodSchema.parse({
              content: [{ type: "text", text: result }],
            });
          } else if (result && typeof result === "object" && "type" in result) {
            return ContentResultZodSchema.parse({
              content: [result],
            });
          } else {
            return ContentResultZodSchema.parse(result);
          }
        } catch (error) {
          if (error instanceof UserError) {
            return {
              content: [{ type: "text", text: error.message }],
              isError: true,
            };
          }
          return {
            content: [{ type: "text", text: `Error: ${error}` }],
            isError: true,
          };
        }
      }
    );
  }

  /**
   * Create the execution context with user data from the request
   * @param mcpServer - The MCP server instance
   * @param progressToken - Optional progress token for reporting progress
   * @param request - The current HTTP request
   */
  private createContext(
    mcpServer: McpServer,
    toolRequest: z.infer<typeof CallToolRequestSchema>,
    _?: Request & { user: any }
  ): Context {
    const progressToken = toolRequest.params?._meta?.progressToken;
    return {
      reportProgress: async (progress: Progress) => {
        if (progressToken) {
          await mcpServer.server.notification({
            method: "notifications/progress",
            params: {
              ...progress,
              progressToken,
            },
          });
        }
      },

      log: {
        debug: (message: string, context?: SerializableValue) => {
          mcpServer.server.sendLoggingMessage({
            level: "debug",
            data: { message, context },
          });
        },
        error: (message: string, context?: SerializableValue) => {
          mcpServer.server.sendLoggingMessage({
            level: "error",
            data: { message, context },
          });
        },
        info: (message: string, context?: SerializableValue) => {
          mcpServer.server.sendLoggingMessage({
            level: "info",
            data: { message, context },
          });
        },
        warn: (message: string, context?: SerializableValue) => {
          mcpServer.server.sendLoggingMessage({
            level: "warning",
            data: { message, context },
          });
        },
      },
    };
  }
}
