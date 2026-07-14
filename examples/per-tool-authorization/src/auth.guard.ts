import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './jwt-secret';

// Freemium: tokenless callers are allowed through (with no `req.user`) so they
// can reach `@PublicTool()` tools; a token, if present, must still be valid.
// This value must match the strategy's `allowUnauthenticatedAccess` — the guard
// and the strategy are two halves of one decision, so the server imports it.
export const allowUnauthenticatedAccess = process.env.FREEMIUM === 'true';

function extractTokenFromHeader(request: Request): string | undefined {
  const [type, token] = request.headers.authorization?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
}

@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const token = extractTokenFromHeader(req);

    if (!token) {
      // Freemium lets anonymous callers through (no req.user) so they can reach
      // @PublicTool() tools; strict mode rejects with 401.
      if (allowUnauthenticatedAccess) {
        return true;
      }
      throw new UnauthorizedException('Access token required');
    }

    try {
      req.user = jwt.verify(token, JWT_SECRET);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid access token');
    }
  }
}
