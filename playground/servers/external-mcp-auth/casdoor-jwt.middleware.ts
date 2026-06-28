import { Request } from 'express';
import { extractBearer, verifyCasdoorToken } from './casdoor-token';

/**
 * ALTERNATIVE (not wired up): Casdoor token validation as Express middleware.
 *
 * The flagship path in this example is `CasdoorAuthGuard` on `McpHttpController` (a
 * real NestJS guard on a real controller). This middleware is kept only to show
 * the other option — e.g. if you mount the MCP route via the transport's
 * self-mount (`mount: true`, the default) instead of your own controller, a Nest
 * guard has nothing to attach to, and middleware is the way to authenticate.
 *
 * To use it, register it in `main.ts` BEFORE the transport mounts its route:
 *
 * ```ts
 * app.use(createCasdoorJwtMiddleware({
 *   issuer: CASDOOR_URL,
 *   jwksUri: `${CASDOOR_URL}/.well-known/jwks`,
 *   resourceMetadataUrl: `${SERVER_URL}/.well-known/oauth-protected-resource/mcp`,
 *   protectedPrefixes: ['/mcp'],
 * }));
 * ```
 *
 * The token validation itself is shared with the guard via `casdoor-token.ts`,
 * so the two paths can never drift.
 */
export interface CasdoorJwtMiddlewareOptions {
  /** Expected `iss` claim — the Casdoor issuer, e.g. http://localhost:8000 */
  issuer: string;
  /** Casdoor JWKS URL, e.g. http://localhost:8000/.well-known/jwks */
  jwksUri: string;
  /** Optional expected `aud`. Off by default — see the RFC 8707 note in casdoor-token.ts. */
  audience?: string;
  /** Absolute URL of the protected-resource metadata, advertised on 401. */
  resourceMetadataUrl: string;
  /** Path prefixes to protect. @default ['/mcp'] */
  protectedPrefixes?: string[];
}

export function createCasdoorJwtMiddleware(
  options: CasdoorJwtMiddlewareOptions,
) {
  const { issuer, jwksUri, audience, resourceMetadataUrl } = options;
  const protectedPrefixes = options.protectedPrefixes ?? ['/mcp'];

  return (req: Request & { user?: unknown }, res: any, next: () => void) => {
    const path: string = req.path ?? req.url ?? '';
    const isProtected = protectedPrefixes.some(
      (prefix) =>
        path === prefix ||
        path.startsWith(`${prefix}?`) ||
        path.startsWith(`${prefix}/`),
    );
    if (!isProtected) {
      return next();
    }

    const unauthorized = (message: string) => {
      // Tell the MCP client where to find the protected-resource metadata so it
      // can discover Casdoor and start the OAuth flow.
      res.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${resourceMetadataUrl}"`,
      );
      res.statusCode = 401;
      res.end(message);
    };

    const token = extractBearer(req.headers.authorization);
    if (!token) {
      return unauthorized('Unauthorized: missing Bearer access token');
    }

    void (async () => {
      try {
        req.user = await verifyCasdoorToken(token, {
          issuer,
          jwksUri,
          audience,
        });
        next();
      } catch (error) {
        unauthorized(
          `Unauthorized: invalid access token (${(error as Error).message})`,
        );
      }
    })();
  };
}
