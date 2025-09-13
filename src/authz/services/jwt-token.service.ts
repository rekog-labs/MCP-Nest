import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { OAuthModuleOptions } from '../providers/oauth-provider.interface';

export interface JwtPayload {
  sub: string; // user_id
  azp?: string; // authorized party (client_id for access tokens)
  client_id?: string; // only for refresh tokens
  scope?: string;
  resource?: string; // MCP server resource identifier
  type: 'access' | 'refresh' | 'user';
  user_data?: any;
  user_profile_id?: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

@Injectable()
export class JwtTokenService {
  private jwtSecret: string;
  private issuer: string;
  private accessTokenExpiresIn: string;
  private refreshTokenExpiresIn: string;
  private enableRefreshTokens: boolean;

  constructor(@Inject('OAUTH_MODULE_OPTIONS') options: OAuthModuleOptions) {
    // Use JWT secret from environment variable
    const jwtSecret = options.jwtSecret;

    if (!jwtSecret) {
      throw new Error('JWT_SECRET must be set in environment variables.');
    }

    this.jwtSecret = jwtSecret;
    this.issuer =
      options.jwtIssuer || options.serverUrl || 'https://localhost:3000';
    this.accessTokenExpiresIn = options.jwtAccessTokenExpiresIn;
    this.refreshTokenExpiresIn = options.jwtRefreshTokenExpiresIn;
    this.enableRefreshTokens = options.enableRefreshTokens;
  }

  generateTokenPair(
    userId: string,
    clientId: string,
    scope = '',
    resource?: string,
    extras?: { user_profile_id?: string; user_data?: any },
  ): TokenPair {
    if (!resource) {
      throw new Error('Resource is required for token generation');
    }

    const jti = randomBytes(16).toString('hex'); // JWT ID for tracking

    const accessTokenPayload: any = {
      sub: userId,
      azp: clientId, // Use azp instead of client_id
      iss: this.issuer,
      aud: resource,
      resource: resource, // Always include resource
      type: 'access' as const,
    };
    if (extras?.user_profile_id) {
      accessTokenPayload.user_profile_id = extras.user_profile_id;
    }
    if (extras?.user_data) {
      accessTokenPayload.user_data = extras.user_data;
    }

    // Always include scope to ensure parity with refresh token claims
    accessTokenPayload.scope = scope || '';

    const accessToken = jwt.sign(accessTokenPayload, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.accessTokenExpiresIn,
    });

    let refreshToken: string | undefined = undefined;
    if (this.enableRefreshTokens) {
      const refreshTokenPayload: any = {
        sub: userId,
        client_id: clientId,
        scope,
        resource,
        type: 'refresh' as const,
        jti: `refresh_${jti}`,
        iss: this.issuer,
        aud: resource,
      };
      if (extras?.user_profile_id) {
        refreshTokenPayload.user_profile_id = extras.user_profile_id;
      }
      refreshToken = jwt.sign(refreshTokenPayload, this.jwtSecret, {
        algorithm: 'HS256',
        expiresIn: this.refreshTokenExpiresIn,
      });
    }

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: this.parseDurationToSeconds(this.accessTokenExpiresIn),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    };
  }

  validateToken(token: string): JwtPayload | null {
    try {
      return jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as JwtPayload;
    } catch {
      return null;
    }
  }

  refreshAccessToken(refreshToken: string): TokenPair | null {
    if (!this.enableRefreshTokens) {
      return null;
    }

    const payload = this.validateToken(refreshToken);

    if (!payload || payload.type !== 'refresh') {
      return null;
    }

    return this.generateTokenPair(
      payload.sub,
      payload.client_id!,
      payload.scope,
      payload.resource,
      {
        user_profile_id: payload.user_profile_id,
        user_data: payload.user_data,
      },
    );
  }

  generateUserToken(userId: string, userData: any): string {
    const jti = randomBytes(16).toString('hex');
    const serverUrl = process.env.SERVER_URL || 'https://localhost:3000';

    const payload = {
      sub: userId,
      type: 'user',
      user_data: userData,
      jti: `user_${jti}`,
      iss: serverUrl,
      aud: 'mcp-client',
    };

    return jwt.sign(payload, this.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: '24h',
    });
  }

  private parseDurationToSeconds(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) {
      throw new Error(`Invalid duration format: ${duration}`);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 60 * 60;
      case 'd':
        return value * 60 * 60 * 24;
      default:
        throw new Error(`Unsupported duration unit: ${unit}`);
    }
  }
}
