import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Type,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtPayload, JwtTokenService } from '../services/jwt-token.service';
import { IOAuthStore } from '../stores/oauth-store.interface';

interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

export function createMcpAuthJwtGuard(authModuleId?: string): Type<CanActivate> {
  const jwtTokenServiceToken = authModuleId
    ? `JwtTokenService_${authModuleId}`
    : 'JwtTokenService';
  const oauthStoreToken = authModuleId
    ? `IOAuthStore_${authModuleId}`
    : 'IOAuthStore';

  @Injectable()
  class McpAuthJwtGuardInstance implements CanActivate {
    constructor(
      @Inject(jwtTokenServiceToken)
      private readonly jwtTokenService: JwtTokenService,
      @Inject(oauthStoreToken) private readonly store: IOAuthStore,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request =
        context.switchToHttp().getRequest<AuthenticatedRequest>();
      const token = this.extractTokenFromHeader(request);

      if (!token) {
        throw new UnauthorizedException('Access token required');
      }

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

  return McpAuthJwtGuardInstance;
}
