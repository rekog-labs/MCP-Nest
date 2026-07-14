import { HttpServer, Logger } from '@nestjs/common';
import {
  BaseRpcContext,
  CustomTransportStrategy,
  MessageHandler,
  Server,
} from '@nestjs/microservices';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  GetPromptResult,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  PromptArgument,
  ReadResourceRequestSchema,
  ReadResourceResult,
  ServerCapabilities,
} from '@modelcontextprotocol/sdk/types.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { normalizeObjectSchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { firstValueFrom } from 'rxjs';
import { z, ZodType } from 'zod';

import {
  MCP_PROMPT_METADATA_KEY,
  MCP_PUBLIC_METADATA_KEY,
  MCP_RESOURCE_METADATA_KEY,
  MCP_RESOURCE_TEMPLATE_METADATA_KEY,
  MCP_ROLES_METADATA_KEY,
  MCP_SCOPES_METADATA_KEY,
  MCP_TOOL_METADATA_KEY,
  PromptMetadata,
  ResourceMetadata,
  ResourceTemplateMetadata,
  ToolMetadata,
} from '../decorators';
import { ToolAuthorizationService } from '../services/tool-authorization.service';
import { createMcpLogger } from '../utils/mcp-logger.factory';
import type { McpRequest } from '../interfaces/mcp-tool.interface';
import type {
  DynamicPromptDefinition,
  DynamicPromptHandler,
  DynamicResourceDefinition,
  DynamicResourceHandler,
  DynamicToolDefinition,
  DynamicToolHandler,
} from '../interfaces';
import {
  mcpTransportFor,
  McpHandlerExtras,
  McpMethodRef,
} from './mcp-transport.constants';
import { McpContext, McpSessionInfo } from './mcp-context';
import { McpServerOptions } from './mcp-server-options.interface';
import { McpTransportContext } from './mcp-transport.interface';
import {
  matchResourceByUri,
  matchResourceTemplateByUri,
} from './resource-matcher';

/** DI token a user can wire (`{ provide: MCP_STRATEGY, useValue: strategy }`) to inject the strategy. */
export const MCP_STRATEGY = 'MCP_STRATEGY';

type Invoke = (payload: unknown, ctx: McpContext) => Promise<unknown>;

interface ToolCapability {
  metadata: ToolMetadata;
  invoke: Invoke;
}
interface ResourceCapability {
  metadata: ResourceMetadata;
  invoke: Invoke;
}
interface TemplateCapability {
  metadata: ResourceTemplateMetadata;
  invoke: Invoke;
}
interface PromptCapability {
  metadata: PromptMetadata;
  invoke: Invoke;
}

let strategyIdCounter = 0;

/**
 * NestJS microservice transport strategy for the Model Context Protocol.
 *
 * Construct one, declare your `@McpController` classes in a module's
 * `controllers`, and connect it: `app.connectMicroservice({ strategy })`. NestJS
 * binds every `@Tool`/`@Resource`/`@Prompt` handler whose transport id matches
 * this strategy's into its `messageHandlers`. On `listen()` the strategy reads each
 * handler's MCP metadata directly off the decorated method, builds the SDK request
 * handlers, and routes invocations through the standard NestJS RPC pipeline — so
 * MCP tools get guards, pipes, interceptors, and exception filters for free.
 *
 * No `McpModule` or DI discovery service is required.
 */
export class McpStrategy extends Server implements CustomTransportStrategy {
  public override transportId: symbol;

  public readonly moduleId: string;
  protected override readonly logger: Logger;

  private readonly authService = new ToolAuthorizationService();
  private httpAdapter?: HttpServer;
  private built = false;

  private readonly tools: ToolCapability[] = [];
  private readonly resources: ResourceCapability[] = [];
  private readonly templates: TemplateCapability[] = [];
  private readonly prompts: PromptCapability[] = [];

  private readonly dynamicTools = new Map<string, ToolCapability>();
  private readonly dynamicResources = new Map<string, ResourceCapability>();
  private readonly dynamicPrompts = new Map<string, PromptCapability>();

  private readonly eventListeners = new Map<
    string,
    Array<(...a: any[]) => void>
  >();

  constructor(public readonly options: McpServerOptions) {
    super();
    // A named server gets its own transport id so NestJS routes only the
    // matching `@McpController({ server })` handlers to this strategy; an
    // unnamed server uses the default shared MCP_TRANSPORT id.
    this.transportId = mcpTransportFor(options.server);
    this.moduleId = `mcp-strategy-${strategyIdCounter++}`;
    this.httpAdapter = options.httpAdapter;
    this.logger = createMcpLogger(McpStrategy.name, this.options);
  }

  /** Provide the Nest HTTP adapter for HTTP transports (call after NestFactory.create). */
  setHttpAdapter(adapter: HttpServer): void {
    this.httpAdapter = adapter;
  }

  // ---------------------------------------------------------------------------
  // CustomTransportStrategy lifecycle
  // ---------------------------------------------------------------------------

  async listen(callback: (err?: unknown, ...args: unknown[]) => void) {
    try {
      this.buildCapabilities();
      this.warnIfNamedServerHasNoDecoratorCapabilities();
      const ctx = this.createTransportContext();
      for (const transport of this.options.transports) {
        await transport.start(ctx);
      }
      callback();
    } catch (err) {
      this.logger.error('Failed to start MCP strategy', err as Error);
      callback(err);
    }
  }

  async close() {
    for (const transport of this.options.transports) {
      try {
        await transport.close();
      } catch (err) {
        this.logger.error('Error closing MCP transport', err as Error);
      }
    }
    this.eventListeners.clear();
  }

  on<
    EventKey extends string = string,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    EventCallback extends Function = Function,
  >(event: EventKey, callback: EventCallback): void {
    const list = this.eventListeners.get(event) ?? [];
    list.push(callback as unknown as (...args: any[]) => void);
    this.eventListeners.set(event, list);
  }

  unwrap<T>(): T {
    return {
      transports: this.options.transports,
      httpAdapter: this.httpAdapter,
    } as T;
  }

  /**
   * A named server (`McpStrategy({ server })`) that bound zero decorator
   * capabilities almost certainly has a name mismatch: no
   * `@McpController({ server: <name> })` targets it, so it would serve an empty
   * endpoint silently. Warn so the misconfiguration is visible at startup.
   *
   * Scoped to named servers on purpose: an unnamed (default) server is commonly
   * populated only at runtime via `registerTool()` (see the dynamic-capabilities
   * multi-server example), and we don't want to warn on that supported pattern.
   * For the same reason the message notes dynamic registration as the escape hatch.
   */
  private warnIfNamedServerHasNoDecoratorCapabilities(): void {
    if (!this.options.server) return;
    const decoratorCount =
      this.tools.length +
      this.resources.length +
      this.templates.length +
      this.prompts.length;
    if (decoratorCount > 0) return;
    this.logger.warn(
      `MCP server '${this.options.server}' started with no @McpController ` +
        `capabilities bound to it. Check that a @McpController({ server: ` +
        `'${this.options.server}' }) exists and is listed in a module's ` +
        `controllers. (Safe to ignore if this server is populated at runtime ` +
        `via strategy.registerTool()/registerResource()/registerPrompt().)`,
    );
  }

  // ---------------------------------------------------------------------------
  // Capability discovery — straight from the bound handlers' metadata
  // ---------------------------------------------------------------------------

  private buildCapabilities(): void {
    if (this.built) return;
    this.built = true;

    for (const [route, handler] of this.messageHandlers) {
      const extras = (handler as MessageHandler & { extras?: McpHandlerExtras })
        .extras;
      if (!extras?.mcpType) {
        // Prune stray non-MCP @MessagePattern handlers bound via the
        // undefined-transport clause, so the MCP server only sees MCP handlers.
        this.messageHandlers.delete(route);
        continue;
      }

      const { mcpType, mcpMethodKey, mcpMethodRef } = extras;
      const invoke: Invoke = (payload, ctx) =>
        this.invokeViaPipeline(handler, payload, ctx);

      switch (mcpType) {
        case 'tool':
          this.tools.push({
            metadata: this.readToolMetadata(mcpMethodRef, mcpMethodKey),
            invoke,
          });
          break;
        case 'resource':
          this.resources.push({
            metadata: this.readMetadata<ResourceMetadata>(
              MCP_RESOURCE_METADATA_KEY,
              mcpMethodRef,
              mcpMethodKey,
            ),
            invoke,
          });
          break;
        case 'resource-template':
          this.templates.push({
            metadata: this.readMetadata<ResourceTemplateMetadata>(
              MCP_RESOURCE_TEMPLATE_METADATA_KEY,
              mcpMethodRef,
              mcpMethodKey,
            ),
            invoke,
          });
          break;
        case 'prompt':
          this.prompts.push({
            metadata: this.readMetadata<PromptMetadata>(
              MCP_PROMPT_METADATA_KEY,
              mcpMethodRef,
              mcpMethodKey,
            ),
            invoke,
          });
          break;
      }
    }
  }

  private readToolMetadata(
    methodRef: McpMethodRef,
    methodKey: string,
  ): ToolMetadata {
    const base: ToolMetadata = {
      ...(Reflect.getMetadata(
        MCP_TOOL_METADATA_KEY,
        methodRef,
      ) as ToolMetadata),
    };
    if (!base.name) base.name = methodKey;
    if (!base.parameters) base.parameters = z.object({});

    const isPublic = Reflect.getMetadata(MCP_PUBLIC_METADATA_KEY, methodRef);
    const requiredScopes = Reflect.getMetadata(
      MCP_SCOPES_METADATA_KEY,
      methodRef,
    );
    const requiredRoles = Reflect.getMetadata(
      MCP_ROLES_METADATA_KEY,
      methodRef,
    );
    if (isPublic !== undefined) base.isPublic = isPublic;
    if (requiredScopes) base.requiredScopes = requiredScopes;
    if (requiredRoles) base.requiredRoles = requiredRoles;
    return base;
  }

  private readMetadata<T extends { name?: string }>(
    key: string,
    methodRef: McpMethodRef,
    methodKey: string,
  ): T {
    const metadata = { ...(Reflect.getMetadata(key, methodRef) as T) };
    if (!metadata.name) metadata.name = methodKey;
    return metadata;
  }

  private getTools(): ToolCapability[] {
    return [...this.tools, ...this.dynamicTools.values()];
  }
  private getResources(): ResourceCapability[] {
    return [...this.resources, ...this.dynamicResources.values()];
  }
  private getTemplates(): TemplateCapability[] {
    return [...this.templates];
  }
  private getPrompts(): PromptCapability[] {
    return [...this.prompts, ...this.dynamicPrompts.values()];
  }

  // ---------------------------------------------------------------------------
  // SDK server + request handlers
  // ---------------------------------------------------------------------------

  private createTransportContext(): McpTransportContext {
    return {
      createServer: () => this.createServer(),
      bindRequestHandlers: (server, session, rawRequest) =>
        this.bindRequestHandlers(server, session, rawRequest),
      httpAdapter: this.httpAdapter,
      options: this.options,
      logger: this.logger,
    };
  }

  private createServer(): McpServer {
    const capabilities: ServerCapabilities = {
      ...(this.options.capabilities ?? {}),
    };
    if (this.getTools().length > 0) {
      capabilities.tools = capabilities.tools ?? { listChanged: true };
    }
    if (this.getResources().length + this.getTemplates().length > 0) {
      capabilities.resources = capabilities.resources ?? { listChanged: true };
    }
    if (this.getPrompts().length > 0) {
      capabilities.prompts = capabilities.prompts ?? { listChanged: true };
    }

    const server = new McpServer(
      {
        name: this.options.name,
        version: this.options.version,
        ...(this.options.title && { title: this.options.title }),
        ...(this.options.description && {
          description: this.options.description,
        }),
        ...(this.options.websiteUrl && { websiteUrl: this.options.websiteUrl }),
        ...(this.options.icons && { icons: this.options.icons }),
      },
      { capabilities, instructions: this.options.instructions ?? '' },
    );

    return this.options.serverMutator
      ? this.options.serverMutator(server)
      : server;
  }

  bindRequestHandlers(
    server: McpServer,
    session: Pick<McpSessionInfo, 'transport' | 'stateless' | 'sessionId'>,
    rawRequest?: unknown,
  ): void {
    this.bindToolHandlers(server, session, rawRequest);
    this.bindResourceHandlers(server, session, rawRequest);
    this.bindPromptHandlers(server, session, rawRequest);
  }

  private buildContext(
    server: McpServer,
    request: McpRequest,
    session: Pick<McpSessionInfo, 'transport' | 'stateless' | 'sessionId'>,
    rawRequest?: unknown,
  ): McpContext {
    const sessionId =
      session.sessionId ??
      (server.server.transport as { sessionId?: string } | undefined)
        ?.sessionId;
    return new McpContext(
      [server, request, { ...session, sessionId }, rawRequest],
      this.logger,
    );
  }

  private getUser(rawRequest?: unknown): any {
    return rawRequest ? (rawRequest as { user?: unknown }).user : undefined;
  }

  private bindToolHandlers(
    server: McpServer,
    session: Pick<McpSessionInfo, 'transport' | 'stateless' | 'sessionId'>,
    rawRequest?: unknown,
  ): void {
    if (this.getTools().length === 0) return;

    const allowUnauthenticatedAccess =
      this.options.allowUnauthenticatedAccess ?? false;

    server.server.setRequestHandler(ListToolsRequestSchema, () => {
      const user = this.getUser(rawRequest);
      const tools = this.getTools()
        .filter((tool) =>
          this.authService.canAccessTool(
            user,
            tool,
            allowUnauthenticatedAccess,
          ),
        )
        .map((tool) => {
          const schema: Record<string, unknown> = {
            name: tool.metadata.name,
            description: tool.metadata.description,
            annotations: tool.metadata.annotations,
            _meta: tool.metadata._meta,
          };
          const securitySchemes = this.authService.generateSecuritySchemes(
            tool,
            allowUnauthenticatedAccess,
          );
          if (securitySchemes.length > 0) {
            schema._meta = { ...(schema._meta as object), securitySchemes };
          }
          const input = normalizeObjectSchema(tool.metadata.parameters);
          if (input) schema.inputSchema = toJsonSchemaCompat(input);
          const output = normalizeObjectSchema(tool.metadata.outputSchema);
          if (output) {
            schema.outputSchema = {
              ...toJsonSchemaCompat(output),
              type: 'object',
            };
          }
          return schema;
        });
      return { tools };
    });

    server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const tool = this.getTools().find(
        (t) => t.metadata.name === request.params.name,
      );
      if (!tool) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown tool: ${request.params.name}`,
        );
      }

      this.authService.validateToolAccess(
        this.getUser(rawRequest),
        tool,
        allowUnauthenticatedAccess,
      );

      if (tool.metadata.parameters) {
        const validation = tool.metadata.parameters.safeParse(
          request.params.arguments ?? {},
        );
        if (!validation.success) {
          const issues = validation.error.issues
            .map((issue) => {
              const path = issue.path.length > 0 ? issue.path.join('.') : '';
              return `${path ? `[${path}]: ` : ''}${issue.message}`;
            })
            .join('; ');
          return {
            content: [{ type: 'text', text: `Invalid parameters: ${issues}` }],
            isError: true,
          };
        }
        request.params.arguments = validation.data as Record<string, unknown>;
      }

      const ctx = this.buildContext(server, request, session, rawRequest);
      try {
        const result = await tool.invoke(request.params.arguments ?? {}, ctx);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return this.formatToolResult(result, tool.metadata.outputSchema);
      } catch (error) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return this.toErrorResult(error);
      }
    });
  }

  private bindResourceHandlers(
    server: McpServer,
    session: Pick<McpSessionInfo, 'transport' | 'stateless' | 'sessionId'>,
    rawRequest?: unknown,
  ): void {
    if (this.getResources().length + this.getTemplates().length === 0) return;

    server.server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: this.getResources().map((r) => r.metadata),
    }));

    server.server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
      resourceTemplates: this.getTemplates().map((r) => r.metadata),
    }));

    server.server.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
        const uri = request.params.uri;
        const templateMatch = matchResourceTemplateByUri(
          this.getTemplates().map((cap) => ({
            uriTemplate: cap.metadata.uriTemplate,
            cap,
          })),
          uri,
        );
        const resourceMatch = matchResourceByUri(
          this.getResources().map((cap) => ({ uri: cap.metadata.uri, cap })),
          uri,
        );

        let invoke: Invoke;
        let params: Record<string, unknown>;
        if (templateMatch) {
          invoke = templateMatch.template.cap.invoke;
          params = { ...templateMatch.params, ...request.params };
        } else if (resourceMatch) {
          invoke = resourceMatch.resource.cap.invoke;
          params = { ...resourceMatch.params, ...request.params };
        } else {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown resource: ${uri}`,
          );
        }

        const ctx = this.buildContext(server, request, session, rawRequest);
        return (await invoke(params, ctx)) as ReadResourceResult;
      },
    );
  }

  private bindPromptHandlers(
    server: McpServer,
    session: Pick<McpSessionInfo, 'transport' | 'stateless' | 'sessionId'>,
    rawRequest?: unknown,
  ): void {
    if (this.getPrompts().length === 0) return;

    server.server.setRequestHandler(ListPromptsRequestSchema, () => ({
      prompts: this.getPrompts().map((prompt) => ({
        name: prompt.metadata.name,
        description: prompt.metadata.description,
        arguments: prompt.metadata.parameters
          ? Object.entries(prompt.metadata.parameters.shape).map(
              ([name, field]): PromptArgument => ({
                name,
                description: field.description,
                required: !field.isOptional(),
              }),
            )
          : [],
      })),
    }));

    server.server.setRequestHandler(GetPromptRequestSchema, async (request) => {
      const prompt = this.getPrompts().find(
        (p) => p.metadata.name === request.params.name,
      );
      if (!prompt) {
        throw new McpError(
          ErrorCode.MethodNotFound,
          `Unknown prompt: ${request.params.name}`,
        );
      }
      const ctx = this.buildContext(server, request, session, rawRequest);
      return (await prompt.invoke(
        request.params.arguments,
        ctx,
      )) as GetPromptResult;
    });
  }

  // ---------------------------------------------------------------------------
  // RPC pipeline invocation
  // ---------------------------------------------------------------------------

  private async invokeViaPipeline(
    handler: MessageHandler,
    payload: unknown,
    ctx: BaseRpcContext,
  ): Promise<unknown> {
    let resultPromise!: Promise<unknown>;
    const done = () => {
      resultPromise = (async () => {
        const resultOrStream: unknown = await handler(payload, ctx);
        return firstValueFrom(this.transformToObservable(resultOrStream));
      })();
      return resultPromise;
    };
    // onProcessingStartHook may be async (request-scoped lifecycle); the base
    // type declares it `void`, so wrap to await defensively without a lint error.
    await Promise.resolve(
      this.onProcessingStartHook(this.transportId, ctx, done),
    );
    try {
      return await resultPromise;
    } finally {
      this.onProcessingEndHook?.(this.transportId, ctx);
    }
  }

  private formatToolResult(result: any, outputSchema?: ZodType): any {
    if (result && typeof result === 'object' && Array.isArray(result.content)) {
      return result;
    }
    const defaultContent = [{ type: 'text', text: JSON.stringify(result) }];
    if (outputSchema) {
      const validation = outputSchema.safeParse(result);
      if (!validation.success) {
        throw new McpError(
          ErrorCode.InternalError,
          `Tool result does not match outputSchema: ${validation.error.message}`,
        );
      }
      return { structuredContent: validation.data, content: defaultContent };
    }
    return { content: defaultContent };
  }

  /**
   * Turn an error thrown while invoking a tool into a result the calling agent
   * can act on.
   *
   * We deliberately surface the most specific message available so the agent can
   * tell *why* the call failed and whether retrying makes sense:
   *
   * - `McpError` is re-thrown so the SDK emits a real JSON-RPC error with its
   *   code (e.g. invalid params, output-schema mismatch).
   * - Errors raised intentionally for the client — `throw new RpcException('…')`
   *   or anything surfaced by a `@UseFilters` exception filter — carry an
   *   explicit message/payload, which we return verbatim as an `isError` result.
   * - Unexpected errors (`throw new Error('boom')` in a handler) are masked to a
   *   generic "Internal server error" by NestJS's default RPC exception handler
   *   *before* they reach here. That is intentional (don't leak internals); to
   *   surface a custom message, throw `RpcException` or register the exported
   *   `McpExceptionFilter`. Either way the agent gets `isError: true` and knows
   *   the failure is server-side, not a bad-input problem it can fix by retrying.
   */
  private toErrorResult(error: unknown): any {
    if (error instanceof McpError) {
      throw error;
    }
    let message = 'Internal server error';
    if (error instanceof Error) {
      message = error.message;
    } else if (typeof error === 'string') {
      message = error;
    } else if (
      error &&
      typeof error === 'object' &&
      typeof (error as { message?: unknown }).message === 'string'
    ) {
      // RpcException payloads arrive as `{ status: 'error', message: '…' }`.
      message = (error as { message: string }).message;
    }
    this.logger.error(message);
    return { content: [{ type: 'text', text: message }], isError: true };
  }

  // ---------------------------------------------------------------------------
  // Dynamic capability registration
  // ---------------------------------------------------------------------------

  registerTool(definition: DynamicToolDefinition): void {
    const handler: DynamicToolHandler = definition.handler;
    this.dynamicTools.set(definition.name, {
      metadata: {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters ?? z.object({}),
        outputSchema: definition.outputSchema,
        annotations: definition.annotations,
        _meta: definition._meta,
        isPublic: definition.isPublic,
        requiredScopes: definition.requiredScopes,
        requiredRoles: definition.requiredRoles,
      },
      invoke: (payload, ctx) =>
        Promise.resolve(
          handler(payload as any, ctx, ctx.getRawRequest()) as unknown,
        ),
    });
  }

  registerResource(definition: DynamicResourceDefinition): void {
    const handler: DynamicResourceHandler = definition.handler;
    this.dynamicResources.set(definition.uri, {
      metadata: {
        uri: definition.uri,
        name: definition.name ?? definition.uri,
        description: definition.description,
        mimeType: definition.mimeType,
        _meta: definition._meta,
      },
      invoke: (payload, ctx) =>
        Promise.resolve(
          handler(payload as any, ctx, ctx.getRawRequest()) as unknown,
        ),
    });
  }

  registerPrompt(definition: DynamicPromptDefinition): void {
    const handler: DynamicPromptHandler = definition.handler;
    this.dynamicPrompts.set(definition.name, {
      metadata: {
        name: definition.name,
        description: definition.description,
        parameters: definition.parameters,
      },
      invoke: (payload, ctx) =>
        Promise.resolve(
          handler(payload as any, ctx, ctx.getRawRequest()) as unknown,
        ),
    });
  }

  removeTool(name: string): void {
    this.dynamicTools.delete(name);
  }
  removeResource(uri: string): void {
    this.dynamicResources.delete(uri);
  }
  removePrompt(name: string): void {
    this.dynamicPrompts.delete(name);
  }
}
