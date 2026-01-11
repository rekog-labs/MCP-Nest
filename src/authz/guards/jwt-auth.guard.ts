import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Optional,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Request } from 'express';
import { JwtPayload, JwtTokenService } from '../services/jwt-token.service';
import { IOAuthStore } from '../stores/oauth-store.interface';
import { McpOptions } from '../../mcp';

export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

@Injectable()
export class McpAuthJwtGuard implements CanActivate {
  constructor(
    @Optional() private readonly jwtTokenService: JwtTokenService | null,
    @Optional()
    @Inject('IOAuthStore')
    private readonly store: IOAuthStore | null,
    private readonly moduleRef: ModuleRef,
    @Optional()
    @Inject('MCP_OPTIONS')
    private readonly options?: McpOptions,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.extractTokenFromHeader(request);

    // Check if unauthenticated access is allowed
    const allowUnauthenticated =
      this.options?.allowUnauthenticatedAccess ?? false;

    if (!token) {
      if (allowUnauthenticated) {
        // Allow unauthenticated sessions
        // Per-tool authorization will decide what's accessible (@PublicTool() tools only)
        return true;
      } else {
        // Standard OAuth flow: Reject and trigger authorization
        throw new UnauthorizedException('Access token required');
      }
    }

    // Resolve services dynamically if not injected directly
    const jwtTokenService =
      this.jwtTokenService ||
      this.moduleRef.get(JwtTokenService, { strict: false });
    const store =
      this.store ||
      this.moduleRef.get<IOAuthStore>('IOAuthStore', { strict: false });

    if (!jwtTokenService || !store) {
      throw new UnauthorizedException('Authentication service not available');
    }

    // If a token is provided, it must be valid
    const payload = jwtTokenService.validateToken(token);

    if (!payload) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    // Enrich request.user with friendly fields for tools
    const enriched: any = { ...payload };
    try {
      if (!enriched.user_data && enriched.user_profile_id) {
        const profile = await store.getUserProfileById(
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
