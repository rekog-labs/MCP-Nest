import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtTokenService } from '@rekog/mcp-nest-auth';

// Validates the Bearer JWT on the MCP route and sets `req.user`. Rejects
// missing/invalid tokens with 401. Uses the module's JwtTokenService so the
// decoded payload shape is exactly what the OAuth module issued.
@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }

    const payload = this.jwt.validateToken(token);
    if (!payload) {
      throw new UnauthorizedException('Unauthorized');
    }

    req.user = payload;
    return true;
  }
}
