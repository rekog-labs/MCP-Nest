import { Injectable, Inject } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { OAuthModuleOptions } from '../providers/oauth-provider.interface';

export interface JwtPayload {
  sub: string; // user_id
  client_id?: string;
  scope?: string;
  type: 'access' | 'refresh' | 'user';
  user_data?: any;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
}

@Injectable()
export class JwtTokenService {
  constructor(
    private readonly jwtService: NestJwtService,
    @Inject('OAUTH_MODULE_OPTIONS') private options: OAuthModuleOptions,
  ) {}

  generateTokenPair(userId: string, clientId: string, scope = ''): TokenPair {
    const jti = randomBytes(16).toString('hex'); // JWT ID for tracking

    const accessToken = this.jwtService.sign(
      {
        sub: userId,
        client_id: clientId,
        scope,
        type: 'access',
        jti: `access_${jti}`,
      } as JwtPayload,
      {
        expiresIn: this.options.jwtAccessTokenExpiresIn,
      },
    );

    const refreshToken = this.jwtService.sign(
      {
        sub: userId,
        client_id: clientId,
        scope,
        type: 'refresh',
        jti: `refresh_${jti}`,
      } as JwtPayload,
      {
        expiresIn: this.options.jwtRefreshTokenExpiresIn,
      },
    );

    return {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'Bearer',
      expires_in: this.parseExpiresIn(this.options.jwtAccessTokenExpiresIn),
      scope,
    };
  }

  validateToken(token: string): JwtPayload | null {
    try {
      return this.jwtService.verify<JwtPayload>(token);
    } catch {
      return null;
    }
  }

  refreshAccessToken(refreshToken: string): TokenPair | null {
    try {
      const payload = this.jwtService.verify(refreshToken) as JwtPayload;

      if (payload.type !== 'refresh') {
        return null;
      }

      return this.generateTokenPair(
        payload.sub,
        payload.client_id!,
        payload.scope,
      );
    } catch (error) {
      return null;
    }
  }

  generateUserToken(userId: string, userData: any): string {
    return this.jwtService.sign(
      {
        sub: userId,
        type: 'user',
        user_data: userData,
      } as JwtPayload,
      {
        expiresIn: `${Math.floor(this.options.cookieMaxAge / 1000)}s`,
      },
    );
  }

  private parseExpiresIn(expiresIn: string): number {
    // Handle formats like "60s", "30d", "24h", "1440m"
    const match = expiresIn.match(/^(\d+)([smhd]?)$/);
    if (!match) {
      throw new Error(`Invalid expiresIn format: ${expiresIn}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2] || 's'; // default to seconds

    const multipliers = {
      s: 1,
      m: 60,
      h: 60 * 60,
      d: 24 * 60 * 60,
    };

    return value * multipliers[unit as keyof typeof multipliers];
  }
}
