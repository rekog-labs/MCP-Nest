import {
  applyDecorators,
  Controller,
  ControllerOptions,
  SetMetadata,
} from '@nestjs/common';
import { MCP_CONTROLLER_METADATA_KEY } from './constants';

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
  prefixOrOptions?: string | string[] | ControllerOptions,
): ClassDecorator {
  return applyDecorators(
    Controller(prefixOrOptions as ControllerOptions),
    SetMetadata(MCP_CONTROLLER_METADATA_KEY, true),
  );
}
