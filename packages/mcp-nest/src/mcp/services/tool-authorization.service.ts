import { Injectable } from '@nestjs/common';
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';
import {
  AccessMatchMode,
  ToolMetadata,
  SecurityScheme,
} from '../decorators/tool.decorator';
import { AuthenticatedUser } from '../interfaces/authenticated-user.interface';

/** Minimal shape the authorization logic needs: a capability carrying tool metadata. */
export interface AuthorizableTool {
  metadata: ToolMetadata;
}

/**
 * Renders the wording shared by the JSON-RPC denial ({@link ToolAuthorizationService.validateToolAccess})
 * and the 403 step-up challenge (`streamable-http.transport.ts`), so the two can
 * never drift: `Tool 'x' requires scopes: a, b` for `'all'`, or
 * `Tool 'x' requires any of scopes: a, b` for `'any'`.
 */
export function describeRequirement(
  toolName: string,
  kind: 'scopes' | 'roles',
  required: string[],
  match: AccessMatchMode,
): string {
  const prefix = match === 'any' ? `any of ${kind}` : kind;
  return `Tool '${toolName}' requires ${prefix}: ${required.join(', ')}`;
}

/**
 * A `tools/call` that would be denied *purely* because the authenticated caller's
 * token lacks scope — the one denial the MCP authorization spec gives a dedicated
 * HTTP answer:
 *
 * > the server SHOULD respond with `HTTP 403 Forbidden` … `WWW-Authenticate`
 * > header with the `Bearer` scheme and additional parameters:
 * > `error="insufficient_scope"`, `scope="required_scope1 required_scope2"`,
 * > `resource_metadata="…"`
 *
 * Reported by {@link ToolAuthorizationService.findScopeDeficiency} so a transport
 * can answer that way *before* the JSON-RPC pipeline settles the HTTP status. See
 * `StreamableHttpTransportOptions.stepUpAuthorization`.
 */
export interface ToolScopeDeficiency {
  /** The tool that was called. */
  toolName: string;
  /** Every scope the tool declares via `@ToolScopes()` — the challenge's `scope`. */
  requiredScopes: string[];
  /** The subset the caller does not hold; always non-empty. */
  missingScopes: string[];
  /** The match mode `requiredScopes` was declared with — lets the transport render the right wording. */
  match: AccessMatchMode;
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
      if (
        !this.hasRequiredScopes(
          user,
          metadata.requiredScopes,
          metadata.requiredScopesMatch ?? 'all',
        )
      ) {
        return false;
      }
    }

    // If tool has specific roles, validate them
    if (metadata.requiredRoles && metadata.requiredRoles.length > 0) {
      if (
        !this.hasRequiredRoles(
          user,
          metadata.requiredRoles,
          metadata.requiredRolesMatch ?? 'all',
        )
      ) {
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
      throw new ProtocolError(
        ProtocolErrorCode.InvalidRequest,
        `Tool '${toolName}' requires authentication`,
      );
    }

    // Validate scopes if required
    if (metadata.requiredScopes && metadata.requiredScopes.length > 0) {
      const requiredScopesMatch = metadata.requiredScopesMatch ?? 'all';
      if (
        !this.hasRequiredScopes(
          user,
          metadata.requiredScopes,
          requiredScopesMatch,
        )
      ) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidRequest,
          describeRequirement(
            toolName,
            'scopes',
            metadata.requiredScopes,
            requiredScopesMatch,
          ),
        );
      }
    }

    // Validate roles if required
    if (metadata.requiredRoles && metadata.requiredRoles.length > 0) {
      const requiredRolesMatch = metadata.requiredRolesMatch ?? 'all';
      if (
        !this.hasRequiredRoles(
          user,
          metadata.requiredRoles,
          requiredRolesMatch,
        )
      ) {
        throw new ProtocolError(
          ProtocolErrorCode.InvalidRequest,
          describeRequirement(
            toolName,
            'roles',
            metadata.requiredRoles,
            requiredRolesMatch,
          ),
        );
      }
    }

    // Freemium mode: an undecorated, non-public tool still requires a user.
    // Standard mode trusts @UseGuards / auth middleware (see canAccessTool).
    if (allowUnauthenticatedAccess && !user) {
      throw new ProtocolError(
        ProtocolErrorCode.InvalidRequest,
        `Tool '${toolName}' requires authentication`,
      );
    }
  }

  /**
   * The scopes a `tools/call` would be denied for, or `undefined` when scope is
   * not the reason it would be denied.
   *
   * This is a *query* over exactly the same primitives {@link validateToolAccess}
   * enforces (same metadata, same {@link missingScopes} maths), so the two can
   * never disagree — it deliberately does not re-derive anything. What it adds is
   * the ability to ask the question BEFORE the JSON-RPC pipeline runs, which is
   * the only point at which an HTTP status is still ours to choose.
   *
   * Returns `undefined` — i.e. "not an `insufficient_scope` case" — for every
   * other denial, because the spec's 403 challenge names *scopes* a client can go
   * and obtain:
   *
   * - a `@PublicTool()`, or a tool with no `@ToolScopes()`: nothing to ask for.
   * - **no authenticated user**: that is a 401 (missing/invalid credentials),
   *   not a 403 — and on a self-mounted route with no guard there is simply no
   *   `req.user` to judge. Either way the pre-existing JSON-RPC denial stands;
   *   inventing an authentication requirement here is not this method's job.
   * - a `@ToolRoles()` failure: roles are not scopes. There is no scope to put in
   *   the challenge and no authorization request that would fix it, so it keeps
   *   its current behaviour. (When a call is short on *both*, the scope shortfall
   *   is reported — matching {@link validateToolAccess}, which checks scopes
   *   first and so already surfaces the scope error today.)
   *
   * Takes no `allowUnauthenticatedAccess`, unlike its siblings: freemium mode only
   * ever changes the verdict for a caller with no user, or for an undecorated tool
   * — and both of those already return `undefined` here.
   *
   * `match: 'any'` scopes: a deficiency is only reported when the caller holds
   * NONE of the required scopes. Holding at least one already satisfies the
   * tool, even though some listed scopes remain "missing" — so that partial
   * case returns `undefined` too. When a deficiency is reported, it still lists
   * every required scope in `requiredScopes` (and as `missingScopes`, since none
   * are held), because obtaining any one of them would fix it.
   */
  findScopeDeficiency(
    user: AuthenticatedUser | undefined,
    tool: AuthorizableTool,
  ): ToolScopeDeficiency | undefined {
    const metadata = tool.metadata;
    if (metadata.isPublic) return undefined;

    const requiredScopes = metadata.requiredScopes ?? [];
    if (requiredScopes.length === 0) return undefined;
    const match = metadata.requiredScopesMatch ?? 'all';

    // Unauthenticated: 401 territory (or freemium's "requires authentication"),
    // handled by whatever already denies it. Note this is also why the check is
    // inert on a self-mounted route — no Nest guard ran, so there is no user.
    if (!user) return undefined;

    const missing = this.missingScopes(user, requiredScopes);
    if (missing.length === 0) return undefined;

    // 'any' mode: holding at least one required scope satisfies the tool, so
    // there is no deficiency to challenge for even though some are missing.
    if (match === 'any' && missing.length < requiredScopes.length) {
      return undefined;
    }

    return {
      toolName: metadata.name,
      requiredScopes: [...requiredScopes],
      missingScopes: missing,
      match,
    };
  }

  /**
   * Check if user has the required scopes, honouring the match mode: `'all'`
   * (every scope, the default) or `'any'` (at least one).
   *
   * @param user - The authenticated user (may be undefined)
   * @param requiredScopes - Array of required scope strings
   * @param match - `'all'` (AND) or `'any'` (OR)
   * @returns true if user satisfies the required scopes for the given match mode
   */
  private hasRequiredScopes(
    user: AuthenticatedUser | undefined,
    requiredScopes: string[],
    match: AccessMatchMode,
  ): boolean {
    if (!user) {
      return false;
    }
    return this.satisfies(this.getUserScopes(user), requiredScopes, match);
  }

  /**
   * Which of `requiredScopes` the user does NOT hold. The single place the scope
   * comparison lives: both the boolean check ({@link hasRequiredScopes}, driving
   * `tools/list` filtering and the `tools/call` denial) and the step-up challenge
   * ({@link findScopeDeficiency}) go through it.
   */
  private missingScopes(
    user: AuthenticatedUser,
    requiredScopes: string[],
  ): string[] {
    const userScopes = this.getUserScopes(user);
    return requiredScopes.filter((required) => !userScopes.includes(required));
  }

  /**
   * The scopes the user holds, whether carried as `scope` (OAuth 2.0 standard:
   * space-delimited string) or `scopes` (array).
   */
  private getUserScopes(user: AuthenticatedUser): string[] {
    if (user.scope) {
      return user.scope.split(' ').filter((s) => s.length > 0);
    } else if ((user as any).scopes && Array.isArray((user as any).scopes)) {
      return (user as any).scopes;
    }
    return [];
  }

  /**
   * Check if user has the required roles, honouring the match mode: `'all'`
   * (every role, the default) or `'any'` (at least one).
   *
   * @param user - The authenticated user (may be undefined)
   * @param requiredRoles - Array of required role strings
   * @param match - `'all'` (AND) or `'any'` (OR)
   * @returns true if user satisfies the required roles for the given match mode
   */
  private hasRequiredRoles(
    user: AuthenticatedUser | undefined,
    requiredRoles: string[],
    match: AccessMatchMode,
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

    return this.satisfies(userRoles, requiredRoles, match);
  }

  /**
   * Whether `held` satisfies `required` under the given match mode: every
   * entry (`'all'`, AND) or at least one (`'any'`, OR).
   */
  private satisfies(
    held: string[],
    required: string[],
    match: AccessMatchMode,
  ): boolean {
    return match === 'any'
      ? required.some((r) => held.includes(r))
      : required.every((r) => held.includes(r));
  }
}
