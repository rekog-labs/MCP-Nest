import { SetMetadata } from '@nestjs/common';

/**
 * Metadata key for storing required roles
 */
export const MCP_ROLES_METADATA_KEY = 'mcp:roles';

/**
 * Decorator to specify roles required to access a tool.
 *
 * When applied to a tool method, it requires the authenticated user to have
 * ALL specified roles in their JWT token or user profile.
 *
 * Can be combined with @ToolScopes() for fine-grained access control.
 *
 * @param roles - Array of required role strings
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
 * }
 * ```
 */
export const ToolRoles = (roles: string[]) => {
  if (!Array.isArray(roles) || roles.length === 0) {
    throw new Error(
      '@ToolRoles() requires a non-empty array of role strings',
    );
  }
  return SetMetadata(MCP_ROLES_METADATA_KEY, roles);
};
