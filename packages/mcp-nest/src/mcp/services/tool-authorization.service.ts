import { Injectable } from '@nestjs/common';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { ToolMetadata, SecurityScheme } from '../decorators/tool.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/** Minimal shape the authorization logic needs: a capability carrying tool metadata. */
export interface AuthorizableTool {
  metadata: ToolMetadata;
}

/**
 * Per-tool authorization.
 *
 * This service powers `tools/list` filtering and the `tools/call` access check
 * based purely on the per-tool decorators (`@PublicTool()`, `@ToolScopes()`,
 * `@ToolRoles()`) and the user resolved off the raw request (`req.user`, set by
 * a guard or by transport-level auth middleware).
 *
 * It is intentionally NOT an authentication mechanism: real enforcement is the
 * job of standard NestJS `@UseGuards()` (which run inside the RPC pipeline at
 * call time) and/or auth middleware on the HTTP routes. This service only
 * decides which tools a *known* principal may see and invoke.
 */
@Injectable()
export class ToolAuthorizationService {
  /**
   * Generate security schemes for a tool, advertised to clients (e.g. ChatGPT)
   * via the OpenAI `securitySchemes` spec so they know which tools need auth.
   *
   * @param tool - The discovered tool
   * @param freemiumMode - Whether the server runs in freemium mode
   *   (`allowUnauthenticatedAccess`). In freemium mode an undecorated,
   *   non-public tool still requires authentication, so it is advertised as
   *   `oauth2`.
   * @returns Array of security schemes for the tool
   */
  generateSecuritySchemes(
    tool: AuthorizableTool,
    freemiumMode: boolean,
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
    // Else if tool requires specific roles, advertise that auth is needed
    else if (metadata.requiredRoles && metadata.requiredRoles.length > 0) {
      schemes.push({ type: 'oauth2' });
    }
    // Else, in freemium mode a non-public tool still requires authentication
    else if (freemiumMode && !metadata.isPublic) {
      schemes.push({ type: 'oauth2' });
    }

    // If no schemes were added, tool is accessible without authentication
    if (schemes.length === 0) {
      schemes.push({ type: 'noauth' });
    }

    return schemes;
  }

  /**
   * Check if a user can access a tool based on its per-tool requirements.
   *
   * @param user - The authenticated user (may be undefined)
   * @param tool - The discovered tool
   * @param allowUnauthenticatedAccess - Whether unauthenticated access is allowed (freemium mode)
   * @returns true if the user can access the tool, false otherwise
   */
  canAccessTool(
    user: AuthenticatedUser | undefined,
    tool: AuthorizableTool,
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

    // At this point the tool is not public and has no (or satisfied) scope/role
    // requirements. The only remaining question is the undecorated tool:
    //
    // - Freemium mode (allowUnauthenticatedAccess = true): anonymous callers may
    //   only reach @PublicTool() (or specifically-scoped) tools, so an
    //   undecorated tool requires a user.
    // - Standard mode (default): real enforcement is delegated to @UseGuards /
    //   auth middleware, so we trust that decision and allow access. (On stdio
    //   there is no request and no user — all undecorated tools are reachable.)
    if (allowUnauthenticatedAccess && !user) {
      return false;
    }

    return true;
  }

  /**
   * Validate that a user can access a tool, throwing an error if not authorized.
   *
   * @param user - The authenticated user (may be undefined)
   * @param tool - The discovered tool
   * @param allowUnauthenticatedAccess - Whether unauthenticated access is allowed (freemium mode)
   * @throws McpError if user is not authorized to access the tool
   */
  validateToolAccess(
    user: AuthenticatedUser | undefined,
    tool: AuthorizableTool,
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

    // Freemium mode: an undecorated, non-public tool still requires a user.
    // Standard mode trusts @UseGuards / auth middleware (see canAccessTool).
    if (allowUnauthenticatedAccess && !user) {
      throw new McpError(
        ErrorCode.InvalidRequest,
        `Tool '${toolName}' requires authentication`,
      );
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
    user: AuthenticatedUser | undefined,
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
    user: AuthenticatedUser | undefined,
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
