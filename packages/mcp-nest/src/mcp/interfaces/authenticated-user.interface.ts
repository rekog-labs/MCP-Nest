/**
 * Minimal shape of an authenticated principal as far as the core per-tool
 * authorization logic is concerned.
 *
 * The core module never authenticates anyone itself — a guard or transport-level
 * auth middleware resolves the user and places it on `req.user`. Per-tool checks
 * (`@ToolScopes()`, `@ToolRoles()`) only read scopes and roles off that object, so
 * core depends on this structural type rather than on any concrete token payload.
 *
 * The auth package's richer `JwtPayload` is structurally compatible with this
 * interface, so no coupling back to `@rekog/mcp-nest-auth` is required.
 */
export interface AuthenticatedUser {
  /** OAuth 2.0 space-delimited scope string. */
  scope?: string;
  /** Roles carried directly on the principal. */
  roles?: string[];
  /** Provider-specific user data; may carry roles. */
  user_data?: { roles?: string[] } & Record<string, any>;
  /** Allow additional, provider-specific claims without widening the read surface. */
  [key: string]: any;
}
