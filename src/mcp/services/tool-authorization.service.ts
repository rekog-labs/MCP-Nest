import { Injectable } from '@nestjs/common';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { DiscoveredTool } from './mcp-registry.service';
import { ToolMetadata, SecurityScheme } from '../decorators/tool.decorator';
import { JwtPayload } from '../../authz/services/jwt-token.service';

/**
 * Service responsible for tool-level authorization logic
 */
@Injectable()
export class ToolAuthorizationService {
  /**
   * Generate security schemes for a tool based on its metadata and module configuration
   *
   * @param tool - The discovered tool
   * @param moduleHasGuards - Whether the module has guards configured
   * @returns Array of security schemes for the tool
   */
  generateSecuritySchemes(
    tool: DiscoveredTool<ToolMetadata>,
    moduleHasGuards: boolean,
  ): SecurityScheme[] {
    const metadata = tool.metadata;
    const schemes: SecurityScheme[] = [];

    // If tool is marked as @PublicTool(), it can be accessed without auth
    if (metadata.isPublic) {
      schemes.push({ type: 'noauth' });
    }

    // If tool has required scopes, add oauth2 scheme with those scopes
    if (metadata.requiredScopes && metadata.requiredScopes.length > 0) {
      schemes.push({ type: 'oauth2', scopes: metadata.requiredScopes });
    }
    // Else if module has guards and tool is not public, require oauth2
    else if (moduleHasGuards && !metadata.isPublic) {
      schemes.push({ type: 'oauth2' });
    }

    // If no schemes were added, tool is accessible without authentication
    if (schemes.length === 0) {
      schemes.push({ type: 'noauth' });
    }

    return schemes;
  }

  /**
   * Check if a user can access a tool based on security requirements
   *
   * @param user - The authenticated user (may be undefined)
   * @param tool - The discovered tool
   * @param moduleHasGuards - Whether the module has guards configured
   * @returns true if user can access the tool, false otherwise
   */
  canAccessTool(
    user: JwtPayload | undefined,
    tool: DiscoveredTool<ToolMetadata>,
    moduleHasGuards: boolean,
  ): boolean {
    const metadata = tool.metadata;

    // If tool is public, always allow access
    if (metadata.isPublic) {
      return true;
    }

    // If module has guards or tool has scope/role requirements, user must be authenticated
    const requiresAuth =
      moduleHasGuards ||
      (metadata.requiredScopes && metadata.requiredScopes.length > 0) ||
      (metadata.requiredRoles && metadata.requiredRoles.length > 0);

    if (requiresAuth && !user) {
      return false;
    }

    // If authenticated, check scopes
    if (metadata.requiredScopes && metadata.requiredScopes.length > 0) {
      if (!this.hasRequiredScopes(user, metadata.requiredScopes)) {
        return false;
      }
    }

    // Check roles if required
    if (metadata.requiredRoles && metadata.requiredRoles.length > 0) {
      if (!this.hasRequiredRoles(user, metadata.requiredRoles)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate that a user can access a tool, throwing an error if not authorized
   *
   * @param user - The authenticated user (may be undefined)
   * @param tool - The discovered tool
   * @param moduleHasGuards - Whether the module has guards configured
   * @throws McpError if user is not authorized to access the tool
   */
  validateToolAccess(
    user: JwtPayload | undefined,
    tool: DiscoveredTool<ToolMetadata>,
    moduleHasGuards: boolean,
  ): void {
    const metadata = tool.metadata;
    const toolName = metadata.name;

    // If tool is public, allow access
    if (metadata.isPublic) {
      return;
    }

    // Check if authentication is required
    const requiresAuth =
      moduleHasGuards ||
      (metadata.requiredScopes && metadata.requiredScopes.length > 0) ||
      (metadata.requiredRoles && metadata.requiredRoles.length > 0);

    if (requiresAuth && !user) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool '${toolName}' requires authentication`,
      );
    }

    // Validate scopes
    if (metadata.requiredScopes && metadata.requiredScopes.length > 0) {
      if (!this.hasRequiredScopes(user, metadata.requiredScopes)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Tool '${toolName}' requires scopes: ${metadata.requiredScopes.join(', ')}`,
        );
      }
    }

    // Validate roles
    if (metadata.requiredRoles && metadata.requiredRoles.length > 0) {
      if (!this.hasRequiredRoles(user, metadata.requiredRoles)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Tool '${toolName}' requires roles: ${metadata.requiredRoles.join(', ')}`,
        );
      }
    }
  }

  /**
   * Check if user has all required scopes
   *
   * @param user - The authenticated user (may be undefined)
   * @param requiredScopes - Array of required scope strings
   * @returns true if user has all required scopes
   */
  private hasRequiredScopes(
    user: JwtPayload | undefined,
    requiredScopes: string[],
  ): boolean {
    if (!user) {
      return false;
    }

    // Get user scopes - could be in 'scope' (space-delimited string) or 'scopes' (array)
    let userScopes: string[] = [];

    if (user.scope) {
      // OAuth 2.0 standard: space-delimited string
      userScopes = user.scope.split(' ').filter((s) => s.length > 0);
    } else if ((user as any).scopes && Array.isArray((user as any).scopes)) {
      // Alternative: array of scopes
      userScopes = (user as any).scopes;
    }

    // Check if user has ALL required scopes
    return requiredScopes.every((required) => userScopes.includes(required));
  }

  /**
   * Check if user has all required roles
   *
   * @param user - The authenticated user (may be undefined)
   * @param requiredRoles - Array of required role strings
   * @returns true if user has all required roles
   */
  private hasRequiredRoles(
    user: JwtPayload | undefined,
    requiredRoles: string[],
  ): boolean {
    if (!user) {
      return false;
    }

    // Get user roles from user data
    let userRoles: string[] = [];

    if ((user as any).roles && Array.isArray((user as any).roles)) {
      userRoles = (user as any).roles;
    } else if (
      user.user_data &&
      user.user_data.roles &&
      Array.isArray(user.user_data.roles)
    ) {
      userRoles = user.user_data.roles;
    }

    // Check if user has ALL required roles
    return requiredRoles.every((required) => userRoles.includes(required));
  }
}
