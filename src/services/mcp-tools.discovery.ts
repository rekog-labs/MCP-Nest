import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Injectable, OnApplicationBootstrap } from "@nestjs/common";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { MCP_TOOL_METADATA_KEY, ToolMetadata } from "../decorators";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError, Progress } from "@modelcontextprotocol/sdk/types.js";

export type Context = {
  reportProgress: (progress: Progress) => Promise<void>;
  log: {
    debug: (message: string, data?: SerializableValue) => void;
    error: (message: string, data?: SerializableValue) => void;
    info: (message: string, data?: SerializableValue) => void;
    warn: (message: string, data?: SerializableValue) => void;
  };
  request: z.infer<typeof CallToolRequestSchema>;
};

type Literal = boolean | null | number | string | undefined;

type SerializableValue =
  | Literal
  | SerializableValue[]
  | { [key: string]: SerializableValue };

type TextContent = {
  type: "text";
  text: string;
};

const TextContentZodSchema = z
  .object({
    type: z.literal("text"),
    /**
     * The text content of the message.
     */
    text: z.string(),
  })
  .strict() satisfies z.ZodType<TextContent>;
type Content = TextContent;

const ContentZodSchema = z.discriminatedUnion("type", [
  TextContentZodSchema,
]) satisfies z.ZodType<Content>;

type ContentResult = {
  content: Content[];
  isError?: boolean;
};

const ContentResultZodSchema = z
  .object({
    content: ContentZodSchema.array(),
    isError: z.boolean().optional(),
  })
  .strict() satisfies z.ZodType<ContentResult>;

class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserError';
  }
}

@Injectable()
export class McpToolsDiscovery implements OnApplicationBootstrap {
  private tools: Array<{
    metadata: ToolMetadata;
    instance: any;
    methodName: string;
  }> = [];

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly metadataScanner: MetadataScanner,
  ) {}

  onApplicationBootstrap() {
    this.collectTools();
  }

  collectTools() {
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

        if (!methodMetaKeys.includes(MCP_TOOL_METADATA_KEY)) {
          return;
        }

        const metadata: ToolMetadata = Reflect.getMetadata(MCP_TOOL_METADATA_KEY, methodRef);

        this.tools.push({
          metadata,
          instance,
          methodName,
        });
      });
    });
  }

  registerTools(mcpServer: McpServer) {
    // Register list tools handler
    mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
      let tools = this.tools.map((tool) => ({
          name: tool.metadata.name,
          description: tool.metadata.description,
          inputSchema: tool.metadata.parameters
            ? zodToJsonSchema(tool.metadata.parameters)
            : undefined,
        }))
      return {
        tools
      };
    });

    // Register call tool handler
    mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.tools.find((tool) => tool.metadata.name === request.params.name);

      if (!tool) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`
        );
      }

      const schema = tool.metadata.parameters;
      let parsedParams = request.params.arguments;

      if (schema && schema instanceof z.ZodType) {
        const result = schema.safeParse(request.params.arguments);
        if (!result.success) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid ${request.params.name} parameters: ${JSON.stringify(result.error.format())}`
          );
        }
        parsedParams = result.data;
      }

      try {
        const context = this.createContext(mcpServer, request);
        const result = await tool.instance[tool.methodName].call(
          tool.instance,
          parsedParams,
          context
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
    });
  }

  private createContext(mcpServer: McpServer, request: z.infer<typeof CallToolRequestSchema>) : Context {
    const progressToken = request.params?._meta?.progressToken;

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
      request,
    };
  }
}