import { MessagePattern } from '@nestjs/microservices';
import {
  buildMcpHandlerExtras,
  buildMcpPattern,
  MCP_TRANSPORT,
  McpCapabilityType,
} from '../transport/mcp-transport.constants';

/**
 * Builds the `@MessagePattern` half of an MCP capability decorator.
 *
 * The returned method decorator registers a NestJS RPC handler scoped to the
 * {@link MCP_TRANSPORT} identifier, with:
 *  - a structured pattern `{ mcp, name }` so the strategy can deterministically
 *    map a discovered capability back to its handler, and
 *  - `extras` `{ mcpType, mcpName }` so the strategy can recognize/prune MCP
 *    handlers from the shared `messageHandlers` map.
 *
 * When `explicitName` is omitted (e.g. a `@Tool` without `name`), the method
 * name is used — mirroring the name-defaulting in `McpRegistryDiscoveryService`,
 * so the discovered metadata name and the pattern name stay in sync.
 */
export function mcpMessagePattern(
  type: McpCapabilityType,
  explicitName?: string,
): MethodDecorator {
  return (target, propertyKey, descriptor: PropertyDescriptor) => {
    const methodKey = String(propertyKey);
    const name = explicitName ?? methodKey;
    return MessagePattern(
      buildMcpPattern(type, name),
      MCP_TRANSPORT,
      // `descriptor.value` is the decorated method; the strategy reads all MCP
      // metadata (tool options + security decorators) off it at listen() time.
      buildMcpHandlerExtras(type, name, methodKey, descriptor.value),
    )(target, propertyKey, descriptor);
  };
}
