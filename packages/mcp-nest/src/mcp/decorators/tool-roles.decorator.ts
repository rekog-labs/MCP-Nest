import { applyDecorators, SetMetadata } from '@nestjs/common';
import { AccessMatchMode } from './tool.decorator';

/**
 * Metadata key for storing required roles
 */
export const MCP_ROLES_METADATA_KEY = 'mcp:roles';

/**
 * Metadata key for storing the match mode (`'all'` | `'any'`) required roles
 * are compared with.
 */
export const MCP_ROLES_MATCH_METADATA_KEY = 'mcp:roles-match';

export interface ToolRolesOptions {
  /**
   * `'all'` (default) requires every listed role (AND). `'any'` grants access
   * when the caller holds at least one of them (OR).
   */
  match?: AccessMatchMode;
}

/**
 * Decorator to specify roles required to access a tool.
 *
 * Use this to restrict tool access based on user roles (RBAC).
 * By default, it requires the authenticated user to have
 * ALL specified roles in their JWT token or user profile. Pass
 * `{ match: 'any' }` to require only one of them instead.
 *
 * Can be combined with @ToolScopes() for fine-grained access control.
 *
 * @param roles - Array of required role strings
 * @param options - Optional settings, e.g. `{ match: 'any' }` for OR semantics
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyTools {
 *   // Requires 'admin' role
 *   @Tool({ name: 'system-config', description: 'Configure system' })
 *   @ToolRoles(['admin'])
 *   async configureSystem(args, ctx, req: McpRequestWithUser) {
 *     return { content: [{ type: 'text', text: 'System configured' }] };
 *   }
 *
 *   // Requires both role and scope
 *   @Tool({ name: 'audit-log', description: 'View audit logs' })
 *   @ToolRoles(['auditor'])
 *   @ToolScopes(['logs.read'])
 *   async viewAuditLog(args, ctx, req: McpRequestWithUser) {
 *     return { content: [{ type: 'text', text: 'Audit log data...' }] };
 *   }
 *
 *   // Reachable by 'admin' OR 'support' (only one is required)
 *   @Tool({ name: 'escalate-ticket', description: 'Escalate a ticket' })
 *   @ToolRoles(['admin', 'support'], { match: 'any' })
 *   async escalateTicket(args, ctx, req: McpRequestWithUser) {
 *     return { content: [{ type: 'text', text: 'Ticket escalated' }] };
 *   }
 * }
 * ```
 */
export const ToolRoles = (roles: string[], options?: ToolRolesOptions) => {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error('@ToolRoles() requires a non-empty array of role strings');
  }
  const match = options?.match ?? 'all';
  if (match !== 'all' && match !== 'any') {
    throw new Error(
      `@ToolRoles() 'match' option must be 'all' or 'any', got '${match as string}'`,
    );
  }
  return applyDecorators(
    SetMetadata(MCP_ROLES_METADATA_KEY, roles),
    SetMetadata(MCP_ROLES_MATCH_METADATA_KEY, match),
  );
};
