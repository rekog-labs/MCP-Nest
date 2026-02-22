import { z } from 'zod';
import { Context } from './mcp-tool.interface';
import { ToolAnnotations } from '../decorators/tool.decorator';

/**
 * Handler function signature for dynamically registered tools.
 * Receives the same arguments as decorator-based tools.
 */
export type DynamicToolHandler = (
  args: Record<string, unknown>,
  context: Context,
  request: any,
) => Promise<any> | any;

/**
 * Definition for a dynamically registered tool.
 * Use this with McpDynamicCapabilityRegistryService.registerTool() to register tools at runtime.
 *
 * @example
 * ```typescript
 * toolBuilder.registerTool({
 *   name: 'search-knowledge',
 *   description: 'Search the knowledge base',
 *   parameters: z.object({ query: z.string() }),
 *   handler: async (args, context) => {
 *     const results = await searchService.search(args.query);
 *     return { content: [{ type: 'text', text: JSON.stringify(results) }] };
 *   },
 * });
 * ```
 */
export interface DynamicToolDefinition {
  /** Unique name for the tool */
  name: string;
  /** Description shown to the LLM */
  description: string;
  /** Zod schema for input validation */
  parameters?: z.ZodType;
  /** Zod schema for output validation */
  outputSchema?: z.ZodType;
  /** MCP tool annotations */
  annotations?: ToolAnnotations;
  /** Additional metadata */
  _meta?: Record<string, any>;
  /** Handler function that executes the tool */
  handler: DynamicToolHandler;
  /** Mark as public (accessible without authentication) */
  isPublic?: boolean;
  /** Required OAuth scopes */
  requiredScopes?: string[];
  /** Required user roles */
  requiredRoles?: string[];
}
