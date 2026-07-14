import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET =
  process.env.JWT_SECRET ??
  'your_super_secret_jwt_key_at_least_32_characters_long';

// Freemium: tokenless callers are allowed through (with no `req.user`) so they
// can reach `@PublicTool()` tools; a token, if present, must still be valid.
// This value must match the strategy's `allowUnauthenticatedAccess` — the guard
// and the strategy are two halves of one decision, so the server imports it.
export const allowUnauthenticatedAccess = true;

function extractTokenFromHeader(request: Request): string | undefined {
  const [type, token] = request.headers.authorization?.split(' ') ?? [];
  return type === 'Bearer' ? token : undefined;
}

@Injectable()
export class SimpleJwtGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const token = extractTokenFromHeader(req);

    if (!token) {
      // Freemium lets anonymous callers through; strict mode would reject here.
      return allowUnauthenticatedAccess;
    }

    try {
      req.user = jwt.verify(token, JWT_SECRET);
      return true;
    } catch {
      return false; // token present but invalid
    }
  }
}
