import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for storing required OAuth scopes
 */
export const MCP_SCOPES_METADATA_KEY = 'mcp:scopes';

/**
 * Decorator to specify OAuth scopes required to access a tool.
 *
 * Use this to restrict tool access based on OAuth permissions (Scopes).
 * When applied, it requires the authenticated user to have
 * ALL specified scopes in their JWT token.
 *
 * Can be combined with @PublicTool() to create tools that work better with authentication
 * but are also accessible anonymously.
 *
 * @param scopes - Array of required OAuth scope strings
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
 * }
 * ```
 */
export const ToolScopes = (scopes: string[]) => {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new Error(
      '@ToolScopes() requires a non-empty array of scope strings',
    );
  }
  return SetMetadata(MCP_SCOPES_METADATA_KEY, scopes);
};
