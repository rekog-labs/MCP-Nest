/**
 * Shared transport identifier for the MCP microservice strategy.
 *
 * Both the MCP capability decorators (`@Tool`, `@Resource`, `@ResourceTemplate`,
 * `@Prompt`) and the {@link McpStrategy} reference this exact symbol. NestJS
 * binds a `@MessagePattern` handler to a strategy only when the handler's
 * declared transport is undefined OR equals the strategy's `transportId`
 * (see `@nestjs/microservices` ListenersController). By tagging MCP handlers
 * with this symbol and setting it as the strategy's `transportId` we get mutual
 * exclusion: other microservice transports never bind MCP handlers, and the MCP
 * strategy prunes any stray non-MCP handler that matched via the undefined-transport
 * clause.
 *
 * Uses the global symbol registry (`Symbol.for`) so it stays stable even if the
 * package is duplicated across `node_modules`.
 */
export const MCP_TRANSPORT = Symbol.for('@rekog/mcp-nest:transport');

/**
 * Transport id for a *named* MCP server, falling back to the default shared id
 * ({@link MCP_TRANSPORT}) when no name is given.
 *
 * Naming a server gives it its own transport id, so NestJS's existing
 * `transport === transportId` routing isolates each server's handlers natively:
 * only `@McpController({ server: <name> })` classes bind to the matching
 * `McpStrategy({ server: <name> })`. An unnamed controller + unnamed strategy
 * keep using {@link MCP_TRANSPORT} — i.e. the original single-server behavior.
 *
 * Uses the global symbol registry (`Symbol.for`) so the id stays stable even if
 * the package is duplicated across `node_modules`.
 */
export const mcpTransportFor = (server?: string): symbol =>
  server ? Symbol.for(`@rekog/mcp-nest:transport:${server}`) : MCP_TRANSPORT;

/**
 * Class-metadata key recording the logical server name an `@McpController` was
 * assigned to (via `@McpController({ server })`). Kept for diagnostics; the
 * actual routing is driven by the per-method transport id, not this key.
 */
export const MCP_SERVER_NAME_METADATA_KEY = 'mcp:server-name';

export type McpCapabilityType =
  | 'tool'
  | 'resource'
  | 'resource-template'
  | 'prompt';

/**
 * Structured message pattern stored for every MCP capability handler. NestJS
 * normalizes object patterns by sorting keys and JSON-stringifying them, so the
 * strategy can deterministically rebuild a route from a discovered capability
 * name and look the handler up via `getHandlerByPattern`.
 */
export interface McpPattern {
  mcp: McpCapabilityType;
  name: string;
  // Index signature keeps the pattern assignable to NestJS's MsObjectPattern.
  [key: string]: string;
}

/**
 * Routing + metadata identity carried in the bound handler's `extras`.
 *
 * `mcpMethodRef` is the original decorated method (`descriptor.value`). NestJS
 * stores `extras` by reference on the handler, so at `listen()` time — after ALL
 * decorators on that method have run — the strategy reads every metadata key off
 * `mcpMethodRef` directly (`@Tool` options + `@ToolScopes`/`@ToolRoles`/etc.),
 * with no DI discovery service.
 */
/** A decorated capability method reference (used to read its metadata at bind time). */
export type McpMethodRef = (...args: any[]) => any;

export interface McpHandlerExtras {
  mcpType: McpCapabilityType;
  mcpName: string;
  mcpMethodKey: string;
  mcpMethodRef: McpMethodRef;
}

export function buildMcpPattern(
  type: McpCapabilityType,
  name: string,
): McpPattern {
  return { mcp: type, name };
}

export function buildMcpHandlerExtras(
  type: McpCapabilityType,
  name: string,
  methodKey: string,
  methodRef: McpMethodRef,
): McpHandlerExtras {
  return {
    mcpType: type,
    mcpName: name,
    mcpMethodKey: methodKey,
    mcpMethodRef: methodRef,
  };
}
