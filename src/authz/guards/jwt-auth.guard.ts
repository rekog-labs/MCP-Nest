import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload, JwtTokenService } from '../services/jwt-token.service';
import { IOAuthStore } from '../stores/oauth-store.interface';

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Injectable()
export class McpAuthJwtGuard implements CanActivate {
  constructor(
    private readonly jwtTokenService: JwtTokenService,
    @Inject('IOAuthStore') private readonly store: IOAuthStore,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    // Allow requests without authentication to pass through
    // Per-tool authorization will decide what's accessible
    if (!token) {
      return true;
    }

    // If a token is provided, it must be valid
    const payload = this.jwtTokenService.validateToken(token);

    if (!payload) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // Enrich request.user with friendly fields for tools
    const enriched: any = { ...payload };
    try {
      if (!enriched.user_data && enriched.user_profile_id) {
        const profile = await this.store.getUserProfileById(
          enriched.user_profile_id,
        );
        if (profile) {
          enriched.user_data = profile;
        }
      }
      const ud = enriched.user_data || {};
      // Provide convenient top-level fields commonly used by tools
      enriched.username =
        enriched.username || ud.username || ud.id || enriched.sub;
      enriched.email = enriched.email || ud.email;
      enriched.displayName = enriched.displayName || ud.displayName;
      enriched.avatarUrl = enriched.avatarUrl || ud.avatarUrl;
      enriched.name =
        enriched.name ||
        ud.displayName ||
        ud.username ||
        ud.email ||
        enriched.sub;

      // Parse scopes: OAuth 2.0 standard is space-delimited string in 'scope' field
      if (enriched.scope && typeof enriched.scope === 'string') {
        enriched.scopes = enriched.scope
          .split(' ')
          .filter((s: string) => s.length > 0);
      } else if (!enriched.scopes) {
        enriched.scopes = [];
      }

      // Extract roles from user_data if present
      if (!enriched.roles && ud.roles && Array.isArray(ud.roles)) {
        enriched.roles = ud.roles;
      } else if (!enriched.roles) {
        enriched.roles = [];
      }
    } catch {
      // Non-fatal; proceed with raw payload
    }

    request.user = enriched as JwtPayload;
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return undefined;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' ? token : undefined;
  }
}
