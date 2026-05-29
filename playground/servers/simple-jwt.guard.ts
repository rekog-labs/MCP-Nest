import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

/**
 * Simple JWT authentication for MCP HTTP transports.
 *
 * MCP routes are now mounted on the HTTP adapter by the transports themselves,
 * not as Nest controllers, so a Nest `CanActivate` guard no longer gates them at
 * the HTTP layer. Instead we authenticate with Express middleware (registered via
 * `app.use(...)`) that validates the Bearer token and sets `req.user`. The bespoke
 * `ToolAuthorizationService` then reads `req.user` to enforce
 * `@PublicTool`/`@ToolScopes`/`@ToolRoles`.
 */
export interface SimpleJwtMiddlewareOptions {
  /**
   * When true, requests without a token are allowed through (with no `req.user`).
   * Per-tool authorization then decides what is reachable (e.g. `@PublicTool()`).
   * When a token IS provided it must still be valid.
   */
  allowUnauthenticatedAccess?: boolean;
  /** JWT signing secret. Falls back to JWT_SECRET / a dev default. */
  jwtSecret?: string;
}

function extractTokenFromHeader(request: Request): string | undefined {
  const [type, token] = request.headers.authorization?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
}

/**
 * Build an Express middleware that authenticates MCP requests via a Bearer JWT.
 * Register it after `connectMicroservice` and before `startAllMicroservices`.
 */
export function createSimpleJwtMiddleware(
  options: SimpleJwtMiddlewareOptions = {},
) {
  const jwtSecret =
    options.jwtSecret ??
    process.env.JWT_SECRET ??
    'your_super_secret_jwt_key_at_least_32_characters_long';
  const allowUnauthenticated = options.allowUnauthenticatedAccess ?? false;

  return (req: Request & { user?: unknown }, res: any, next: () => void) => {
    const token = extractTokenFromHeader(req);

    if (!token) {
      if (allowUnauthenticated) {
        return next();
      }
      res.statusCode = 401;
      res.end('Access token required');
      return;
    }

    try {
      req.user = jwt.verify(token, jwtSecret);
      return next();
    } catch {
      res.statusCode = 401;
      res.end('Invalid token');
    }
  };
}
