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
   * @param allowUnauthenticatedAccess - Whether unauthenticated access is allowed (freemium mode)
   * @returns true if user can access the tool, false otherwise
   */
  canAccessTool(
    user: JwtPayload | undefined,
    tool: DiscoveredTool<ToolMetadata>,
    moduleHasGuards: boolean,
    allowUnauthenticatedAccess: boolean = false,
  ): boolean {
    const metadata = tool.metadata;

    // If tool is public, always allow access
    if (metadata.isPublic) {
      return true;
    }

    // If tool has specific scope/role requirements, user MUST be authenticated
    const hasSpecificRequirements =
      (metadata.requiredScopes && metadata.requiredScopes.length > 0) ||
      (metadata.requiredRoles && metadata.requiredRoles.length > 0);

    if (hasSpecificRequirements && !user) {
      return false;
    }

    // If tool has specific scopes, validate them
    if (metadata.requiredScopes && metadata.requiredScopes.length > 0) {
      if (!this.hasRequiredScopes(user, metadata.requiredScopes)) {
        return false;
      }
    }

    // If tool has specific roles, validate them
    if (metadata.requiredRoles && metadata.requiredRoles.length > 0) {
      if (!this.hasRequiredRoles(user, metadata.requiredRoles)) {
        return false;
      }
    }

    // At this point:
    // - Tool is not public
    // - Tool has no specific scope/role requirements (or they passed)
    //
    // Decision logic based on allowUnauthenticatedAccess:
    //
    // allowUnauthenticatedAccess = false (default, standard auth mode):
    // - Guards are expected to fully authorize requests (via JWT, API keys, etc)
    // - If guard let request through AND there's no user object:
    //   * Guard used non-JWT auth mechanism (API key, IP whitelist, etc)
    //   * Trust the guard's decision to authorize
    // - If no guards configured, allow access (no auth required)
    //
    // allowUnauthenticatedAccess = true (freemium mode):
    // - Guards may let unauthenticated requests through for per-tool auth
    // - Only @PublicTool or tools with specific scopes/roles accessible
    // - Tools without decorators require authentication (user must be present)
    //
    if (allowUnauthenticatedAccess && moduleHasGuards && !user) {
      // Freemium mode: unauthenticated access only for @PublicTool or specific scopes
      // This tool has no decorators, so it requires authentication
      return false;
    }

    // Standard mode: If we're here, either:
    // - No guards (open access)
    // - Guards authorized it (trust guard decision, even without user object)
    // - User is present and passed all checks
    return true;
  }

  /**
   * Validate that a user can access a tool, throwing an error if not authorized
   *
   * @param user - The authenticated user (may be undefined)
   * @param tool - The discovered tool
   * @param moduleHasGuards - Whether the module has guards configured
   * @param allowUnauthenticatedAccess - Whether unauthenticated access is allowed (freemium mode)
   * @throws McpError if user is not authorized to access the tool
   */
  validateToolAccess(
    user: JwtPayload | undefined,
    tool: DiscoveredTool<ToolMetadata>,
    moduleHasGuards: boolean,
    allowUnauthenticatedAccess: boolean = false,
  ): void {
    const metadata = tool.metadata;
    const toolName = metadata.name;

    // If tool is public, allow access
    if (metadata.isPublic) {
      return;
    }

    // Check if tool has specific scope/role requirements
    const hasSpecificRequirements =
      (metadata.requiredScopes && metadata.requiredScopes.length > 0) ||
      (metadata.requiredRoles && metadata.requiredRoles.length > 0);

    if (hasSpecificRequirements && !user) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool '${toolName}' requires authentication`,
      );
    }

    // Validate scopes if required
    if (metadata.requiredScopes && metadata.requiredScopes.length > 0) {
      if (!this.hasRequiredScopes(user, metadata.requiredScopes)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Tool '${toolName}' requires scopes: ${metadata.requiredScopes.join(', ')}`,
        );
      }
    }

    // Validate roles if required
    if (metadata.requiredRoles && metadata.requiredRoles.length > 0) {
      if (!this.hasRequiredRoles(user, metadata.requiredRoles)) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Tool '${toolName}' requires roles: ${metadata.requiredRoles.join(', ')}`,
        );
      }
    }

    // At this point:
    // - Tool is not public
    // - Tool has no specific scope/role requirements (or they passed)
    //
    // Decision logic based on allowUnauthenticatedAccess:
    //
    // allowUnauthenticatedAccess = false (default, standard auth mode):
    // - Guards are expected to fully authorize requests (via JWT, API keys, etc)
    // - If guard let request through AND there's no user object:
    //   * Guard used non-JWT auth mechanism (API key, IP whitelist, etc)
    //   * Trust the guard's decision to authorize
    // - If no guards configured, allow access (no auth required)
    //
    // allowUnauthenticatedAccess = true (freemium mode):
    // - Guards may let unauthenticated requests through for per-tool auth
    // - Only @PublicTool or tools with specific scopes/roles accessible
    // - Tools without decorators require authentication (user must be present)
    //
    if (allowUnauthenticatedAccess && moduleHasGuards && !user) {
      // Freemium mode: unauthenticated access only for @PublicTool or specific scopes
      // This tool has no decorators, so it requires authentication
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool '${toolName}' requires authentication`,
      );
    }

    // Standard mode: If we're here, either:
    // - No guards (open access)
    // - Guards authorized it (trust guard decision, even without user object)
    // - User is present and passed all checks
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
