import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as jwt from 'jsonwebtoken';
import type { OAuthModuleOptions } from '../providers/oauth-provider.interface';

export interface JwtPayload {
  sub: string; // user_id
  azp?: string; // authorized party (client_id for access tokens)
  client_id?: string; // only for refresh tokens
  scope?: string;
  resource?: string; // MCP server resource identifier
  type: 'access' | 'refresh' | 'user';
  user_data?: any;
  user_profile_id?: string;
  iss?: string;
  aud?: string | string[];
  iat?: number;
  exp?: number;
}

/**
 * What the caller expects a token to be, beyond a valid signature.
 *
 * The issuer is checked unconditionally — every token this service mints
 * carries the same `iss` — but the audience and the token kind are only known
 * to the caller. Both matter: all three token kinds are HS256-signed with the
 * *same* secret, so signature validity alone does not make a refresh token or
 * a browser-cookie token usable as a bearer credential, and RFC 8707 §2
 * requires a resource server to accept only tokens minted for itself.
 */
export interface TokenExpectations {
  /** The MCP resource identifier the token's `aud` must name. */
  audience?: string;
  /** The `type` claim the token must carry. */
  type?: JwtPayload['type'];
}

/**
 * RFC 8707 audience match. `aud` may be a single value or an array; either way
 * the expected resource has to appear verbatim — no prefix or origin matching,
 * which would let a token for `https://host/a/mcp` pass at `https://host/b/mcp`.
 */
function audienceIncludes(
  aud: string | string[] | undefined,
  expected: string,
): boolean {
  return Array.isArray(aud) ? aud.includes(expected) : aud === expected;
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
  private readonly logger = new Logger(JwtTokenService.name);
  private jwtSecret: string;
  private issuer: string;
  private resource: string;
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
    this.resource = options.resource;
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
      expiresIn: this.accessTokenExpiresIn as jwt.SignOptions['expiresIn'],
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
        expiresIn: this.refreshTokenExpiresIn as jwt.SignOptions['expiresIn'],
      });
    }

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: this.parseDurationToSeconds(this.accessTokenExpiresIn),
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    };
  }

  /**
   * Verify a token and, per RFC 8707 §2, that it was issued *for this server*.
   *
   * The issuer is always checked. Pass `expected` to also pin the audience and
   * the token kind — without an audience check a token minted by the same
   * authorization server for a *different* MCP resource would be accepted here,
   * and without a type check the `type: 'user'` browser-cookie token would work
   * as a bearer credential.
   *
   * Returns `null` on any failure and logs the reason at warn level so a
   * misconfigured `resource`/`jwtIssuer` is diagnosable instead of surfacing as
   * an unexplained 401. Claim values are only named once the signature has
   * verified, so a forged or unrelated token never has its contents echoed into
   * the logs.
   */
  validateToken(
    token: string,
    expected?: TokenExpectations,
  ): JwtPayload | null {
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, this.jwtSecret, {
        algorithms: ['HS256'],
      }) as JwtPayload;
    } catch (err) {
      const { name, message } = err as Error;
      this.logger.warn(`Token rejected: ${name}: ${message}`);
      return null;
    }

    if (payload.iss !== this.issuer) {
      this.logger.warn(
        `Token rejected: issuer mismatch (expected '${this.issuer}', got ` +
          `'${payload.iss ?? '<none>'}'). Tokens minted before a jwtIssuer/` +
          `serverUrl change are no longer valid.`,
      );
      return null;
    }

    if (
      expected?.audience &&
      !audienceIncludes(payload.aud, expected.audience)
    ) {
      this.logger.warn(
        `Token rejected: audience mismatch (expected '${expected.audience}', ` +
          `got '${String(payload.aud ?? '<none>')}'). A token issued for another ` +
          `resource must not be accepted here (RFC 8707 §2); check that the ` +
          `module's 'resource' option is the endpoint clients actually connect to.`,
      );
      return null;
    }

    if (expected?.type && payload.type !== expected.type) {
      this.logger.warn(
        `Token rejected: expected a '${expected.type}' token but got ` +
          `'${payload.type ?? '<none>'}'.`,
      );
      return null;
    }

    return payload;
  }

  refreshAccessToken(refreshToken: string): TokenPair | null {
    if (!this.enableRefreshTokens) {
      return null;
    }

    const payload = this.validateToken(refreshToken, {
      type: 'refresh',
      audience: this.resource,
    });

    if (!payload) {
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

  /**
   * Mint the browser-session cookie token. Deliberately NOT a bearer credential:
   * its audience is the client app, not the MCP resource, and its `type: 'user'`
   * is what stops it from being replayed as an access token.
   */
  generateUserToken(userId: string, userData: any): string {
    const jti = randomBytes(16).toString('hex');

    const payload = {
      sub: userId,
      type: 'user',
      user_data: userData,
      jti: `user_${jti}`,
      // The canonical issuer, same as the access/refresh tokens — it used to be
      // read from process.env.SERVER_URL, which could disagree with the
      // configured issuer and made the claim unverifiable.
      iss: this.issuer,
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
