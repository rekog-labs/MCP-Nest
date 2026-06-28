import {
  applyDecorators,
  Controller,
  ControllerOptions,
  SetMetadata,
} from '@nestjs/common';
import { MCP_CONTROLLER_METADATA_KEY } from './constants';
import {
  MCP_SERVER_NAME_METADATA_KEY,
  mcpTransportFor,
} from '../transport/mcp-transport.constants';

/**
 * NestJS-internal metadata keys written by `@MessagePattern`. They are NOT
 * re-exported from the `@nestjs/microservices` package entry, so we reference
 * the string literals directly (see `@nestjs/microservices/constants`:
 * `PATTERN_EXTRAS_METADATA` / `TRANSPORT_METADATA`). The multi-server e2e test
 * guards against these drifting on a NestJS bump.
 */
const PATTERN_EXTRAS_METADATA = 'microservices:pattern_extras';
const TRANSPORT_METADATA = 'microservices:transport';

/** Options for {@link McpController}: standard `@Controller` options plus a server name. */
export interface McpControllerOptions extends ControllerOptions {
  /**
   * Logical MCP server name. The controller's MCP methods bind ONLY to a
   * connected `McpStrategy({ server: <name> })`. Omit to use the default shared
   * server (binds to a plain `McpStrategy()`).
   */
  server?: string;
}

/**
 * Re-tags every MCP capability method on `target`'s prototype with the given
 * transport id, overriding the default {@link MCP_TRANSPORT} that the
 * `@Tool`/`@Resource`/`@Prompt` method decorators wrote.
 *
 * This works because class decorators run AFTER the method decorators, and both
 * `@MessagePattern` and this walk reach the SAME function reference via
 * `prototype[key]` — so re-defining the transport metadata on it wins. We
 * recognize MCP methods by the `mcpType` marker stored in their pattern extras.
 *
 * Note: `Object.getOwnPropertyNames` only sees methods declared on this class,
 * not ones inherited from a base class.
 */
function retagMcpMethodsTransport(
  target: Function,
  transportId: symbol,
): void {
  const proto = (target as { prototype?: Record<string, unknown> }).prototype;
  if (!proto) return;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor') continue;
    const fn = proto[key];
    if (typeof fn !== 'function') continue;
    const extras = Reflect.getMetadata(PATTERN_EXTRAS_METADATA, fn) as
      | { mcpType?: unknown }
      | undefined;
    if (extras && extras.mcpType) {
      Reflect.defineMetadata(TRANSPORT_METADATA, transportId, fn);
    }
  }
}

/**
 * Marks a class as an MCP capability controller.
 *
 * NestJS only scans classes registered in a module's `controllers` array for
 * microservice (`@MessagePattern`) handlers, so MCP tool/resource/prompt classes
 * MUST be controllers. `@McpController` composes the standard `@Controller()`
 * decorator (so the framework discovers and binds the `@Tool`/`@Resource`/
 * `@Prompt` handlers) and adds a marker the {@link McpStrategy} uses to recognize
 * MCP controllers.
 *
 * Because `@Tool`/`@Resource`/`@Prompt` do not add HTTP route decorators, methods
 * on an `@McpController` are NOT exposed as HTTP routes — they are reachable only
 * through the MCP transport.
 *
 * To run multiple isolated MCP servers in one app, assign a controller to a
 * named server with `@McpController({ server: 'admin' })`; its tools/resources/
 * prompts then bind ONLY to a matching `McpStrategy({ server: 'admin' })`.
 *
 * @example
 * ```typescript
 * @McpController()
 * export class GreetingTool {
 *   @Tool({ name: 'hello', description: 'Say hello', parameters: z.object({ name: z.string() }) })
 *   sayHello(@Payload() { name }: { name: string }, @Ctx() ctx: McpContext) {
 *     return { content: [{ type: 'text', text: `Hello, ${name}!` }] };
 *   }
 * }
 * ```
 */
export function McpController(
  prefixOrOptions?: string | string[] | McpControllerOptions,
): ClassDecorator {
  // Extract the MCP-specific `server` name (if any) and forward the remaining
  // standard controller options to `@Controller`.
  let server: string | undefined;
  let controllerOptions: string | string[] | ControllerOptions | undefined =
    prefixOrOptions;
  if (
    prefixOrOptions &&
    typeof prefixOrOptions === 'object' &&
    !Array.isArray(prefixOrOptions) &&
    'server' in prefixOrOptions
  ) {
    const { server: serverName, ...rest } = prefixOrOptions;
    server = serverName;
    controllerOptions = rest;
  }

  return (target: Function) => {
    applyDecorators(
      Controller(controllerOptions as ControllerOptions),
      SetMetadata(MCP_CONTROLLER_METADATA_KEY, true),
      SetMetadata(MCP_SERVER_NAME_METADATA_KEY, server),
    )(target);
    // A named server re-tags this controller's MCP methods with that server's
    // transport id, so NestJS routes them only to the matching strategy. An
    // unnamed controller keeps the default MCP_TRANSPORT (single-server) behavior.
    if (server) {
      retagMcpMethodsTransport(target, mcpTransportFor(server));
    }
  };
}
