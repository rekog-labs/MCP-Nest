import { applyDecorators, SetMetadata } from '@nestjs/common';
import { AccessMatchMode } from './tool.decorator';

/**
 * Metadata key for storing required OAuth scopes
 */
export const MCP_SCOPES_METADATA_KEY = 'mcp:scopes';

/**
 * Metadata key for storing the match mode (`'all'` | `'any'`) required scopes
 * are compared with.
 */
export const MCP_SCOPES_MATCH_METADATA_KEY = 'mcp:scopes-match';

export interface ToolScopesOptions {
  /**
   * `'all'` (default) requires every listed scope (AND). `'any'` grants access
   * when the caller holds at least one of them (OR).
   */
  match?: AccessMatchMode;
}

/**
 * Decorator to specify OAuth scopes required to access a tool.
 *
 * Use this to restrict tool access based on OAuth permissions (Scopes).
 * By default, it requires the authenticated user to have
 * ALL specified scopes in their JWT token. Pass `{ match: 'any' }` to
 * require only one of them instead.
 *
 * Can be combined with @PublicTool() to create tools that work better with authentication
 * but are also accessible anonymously.
 *
 * @param scopes - Array of required OAuth scope strings
 * @param options - Optional settings, e.g. `{ match: 'any' }` for OR semantics
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyTools {
 *   // Requires 'admin' and 'write' scopes
 *   @Tool({ name: 'delete-user', description: 'Delete a user' })
 *   @ToolScopes(['admin', 'write'])
 *   async deleteUser(args, ctx, req: McpRequestWithUser) {
 *     // Only users with both 'admin' AND 'write' scopes can call this
 *     return { content: [{ type: 'text', text: 'User deleted' }] };
 *   }
 *
 *   // Optional auth - works better with 'premium' scope
 *   @Tool({ name: 'search', description: 'Search content' })
 *   @PublicTool()
 *   @ToolScopes(['premium'])
 *   async search(args, ctx, req: McpRequestWithUser) {
 *     if (req.user?.scopes?.includes('premium')) {
 *       return { content: [{ type: 'text', text: 'AI-powered results' }] };
 *     }
 *     return { content: [{ type: 'text', text: 'Basic results' }] };
 *   }
 *
 *   // Reachable with 'premium' OR 'admin' scope (only one is required)
 *   @Tool({ name: 'premium-report', description: 'View a premium report' })
 *   @ToolScopes(['premium', 'admin'], { match: 'any' })
 *   async premiumReport(args, ctx, req: McpRequestWithUser) {
 *     return { content: [{ type: 'text', text: 'Report data...' }] };
 *   }
 * }
 * ```
 */
export const ToolScopes = (scopes: string[], options?: ToolScopesOptions) => {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error(
      '@ToolScopes() requires a non-empty array of scope strings',
    );
  }
  const match = options?.match ?? 'all';
  if (match !== 'all' && match !== 'any') {
    throw new Error(
      `@ToolScopes() 'match' option must be 'all' or 'any', got '${match as string}'`,
    );
  }
  return applyDecorators(
    SetMetadata(MCP_SCOPES_METADATA_KEY, scopes),
    SetMetadata(MCP_SCOPES_MATCH_METADATA_KEY, match),
  );
};
