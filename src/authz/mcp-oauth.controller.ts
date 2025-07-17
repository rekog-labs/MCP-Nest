import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Next,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Request as ExpressRequest, NextFunction, Response } from 'express';
import passport from 'passport';
import { AuthenticatedRequest, JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  OAuthModuleOptions,
  OAuthSession,
  OAuthUserProfile,
} from './providers/oauth-provider.interface';
import { ClientService } from './services/client.service';
import { JwtTokenService, TokenPair } from './services/jwt-token.service';
import { STRATEGY_NAME } from './services/oauth-strategy.service';
import {
  ClientRegistrationDto,
  IOAuthStore,
} from './stores/oauth-store.interface';

interface OAuthCallbackRequest extends ExpressRequest {
  user?: {
    profile: OAuthUserProfile;
    accessToken: string;
    provider: string;
  };
}

@Controller()
export class McpOAuthController {
  private readonly serverUrl: string;
  private readonly isProduction: boolean;

  constructor(
    @Inject('OAUTH_MODULE_OPTIONS') private options: OAuthModuleOptions,
    @Inject('IOAuthStore') private readonly store: IOAuthStore,
    private readonly jwtTokenService: JwtTokenService,
    private readonly clientService: ClientService,
  ) {
    this.serverUrl = this.options.serverUrl;
    this.isProduction = this.options.cookieSecure;
  }

  // OAuth endpoints
  @Get('/.well-known/oauth-authorization-server')
  getAuthorizationServerMetadata() {
    return {
      issuer: this.serverUrl,
      authorization_endpoint: `${this.serverUrl}/authorize`,
      token_endpoint: `${this.serverUrl}/token`,
      registration_endpoint: `${this.serverUrl}/register`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: [
        'client_secret_basic',
        'client_secret_post',
        'none',
      ],
      revocation_endpoint: `${this.serverUrl}/revoke`,
      code_challenge_methods_supported: ['plain', 'S256'],
    };
  }

  @Post('/register')
  async registerClient(@Body() registrationDto: ClientRegistrationDto) {
    return await this.clientService.registerClient(registrationDto);
  }

  @Get('/authorize')
  async authorize(@Query() query: any, @Res() res: Response) {
    const {
      response_type,
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      state,
      resource,
    } = query;

    // Validate parameters
    if (response_type !== 'code') {
      throw new BadRequestException('Only response_type=code is supported');
    }

    if (!client_id || !redirect_uri || !code_challenge) {
      throw new BadRequestException('Missing required parameters');
    }

    // Validate client and redirect URI
    const client = await this.clientService.getClient(client_id);
    if (!client) {
      throw new BadRequestException('Invalid client_id');
    }

    const validRedirect = await this.clientService.validateRedirectUri(
      client_id,
      redirect_uri,
    );
    if (!validRedirect) {
      throw new BadRequestException('Invalid redirect_uri');
    }

    // Create OAuth session
    const sessionId = randomBytes(32).toString('base64url');
    const sessionState = randomBytes(32).toString('base64url');

    const oauthSession: OAuthSession = {
      sessionId,
      state: sessionState,
      clientId: client_id,
      redirectUri: redirect_uri,
      codeChallenge: code_challenge,
      codeChallengeMethod: code_challenge_method || 'plain',
      oauthState: state,
      resource,
      expiresAt: Date.now() + this.options.oauthSessionExpiresIn,
    };

    this.store.storeOAuthSession(sessionId, oauthSession);

    // Set session cookie
    res.cookie('oauth_session', sessionId, {
      httpOnly: true,
      secure: this.isProduction,
      maxAge: this.options.oauthSessionExpiresIn,
    });

    // Store state for passport
    res.cookie('oauth_state', sessionState, {
      httpOnly: true,
      secure: this.isProduction,
      maxAge: this.options.oauthSessionExpiresIn,
    });

    // Redirect to the provider's auth endpoint
    res.redirect(`/auth`);
  }

  @Get('/auth')
  authenticate(
    @Req() req: any,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    passport.authenticate(STRATEGY_NAME, {
      state: req.cookies?.oauth_state,
    })(req, res, next);
  }

  @Get('/auth/callback')
  async handleProviderCallback(
    @Req() req: OAuthCallbackRequest,
    @Res() res: Response,
    @Next() next: NextFunction,
  ) {
    // Use a custom callback to handle the authentication result
    passport.authenticate(
      STRATEGY_NAME,
      { session: false },
      async (err: any, user: any) => {
        try {
          if (err) {
            console.error('OAuth callback error:', err);
            throw new BadRequestException('Authentication failed');
          }

          if (!user) {
            throw new BadRequestException('Authentication failed');
          }

          req.user = user;
          await this.processAuthenticationSuccess(req, res);
        } catch (error) {
          next(error);
        }
      },
    )(req, res, next);
  }

  private async processAuthenticationSuccess(
    req: OAuthCallbackRequest,
    res: Response,
  ) {
    const user = req.user;
    if (!user) {
      throw new BadRequestException('Authentication failed');
    }

    const sessionId = req.cookies?.oauth_session;
    if (!sessionId) {
      throw new BadRequestException('Missing OAuth session');
    }

    const session = await this.store.getOAuthSession(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      throw new BadRequestException('Invalid or expired OAuth session');
    }

    // Verify state
    const stateFromCookie = req.cookies?.oauth_state;
    if (session.state !== stateFromCookie) {
      throw new BadRequestException('Invalid state parameter');
    }

    // Generate JWT for UI access
    const jwt = this.jwtTokenService.generateUserToken(
      user.profile.username,
      user.profile,
    );

    // Set JWT token as cookie for UI endpoints
    res.cookie('auth_token', jwt, {
      httpOnly: true,
      secure: this.isProduction,
      maxAge: this.options.cookieMaxAge,
    });

    // Clear temporary cookies
    res.clearCookie('oauth_session');
    res.clearCookie('oauth_state');

    // Generate authorization code
    const authCode = randomBytes(32).toString('base64url');

    // Store the auth code
    this.store.storeAuthCode({
      code: authCode,
      user_id: user.profile.username,
      client_id: session.clientId!,
      redirect_uri: session.redirectUri!,
      code_challenge: session.codeChallenge!,
      code_challenge_method: session.codeChallengeMethod!,
      expires_at: Date.now() + this.options.authCodeExpiresIn,
      github_access_token: '', // No longer provider-specific
    });

    // Build redirect URL with authorization code
    const redirectUrl = new URL(session.redirectUri!);
    redirectUrl.searchParams.set('code', authCode);
    if (session.oauthState) {
      redirectUrl.searchParams.set('state', session.oauthState);
    }

    // Clean up session
    this.store.removeOAuthSession(sessionId);

    res.redirect(redirectUrl.toString());
  }

  // Token endpoints (remain the same)
  @Post('/token')
  async exchangeToken(@Body() body: any): Promise<TokenPair> {
    const {
      grant_type,
      code,
      code_verifier,
      redirect_uri,
      client_id,
      refresh_token,
    } = body;

    if (grant_type === 'authorization_code') {
      return this.handleAuthorizationCodeGrant(
        code,
        code_verifier,
        redirect_uri,
        client_id,
      );
    } else if (grant_type === 'refresh_token') {
      return this.handleRefreshTokenGrant(refresh_token);
    } else {
      throw new BadRequestException('Unsupported grant_type');
    }
  }

  private async handleAuthorizationCodeGrant(
    code: string,
    code_verifier: string,
    redirect_uri: string,
    client_id: string,
  ): Promise<TokenPair> {
    // Validate the authorization code
    const authCode = await this.store.getAuthCode(code);
    if (!authCode) {
      throw new BadRequestException('Invalid authorization code');
    }

    // Check if code has expired
    if (authCode.expires_at < Date.now()) {
      await this.store.removeAuthCode(code);
      throw new BadRequestException('Authorization code has expired');
    }

    // Validate client_id matches
    if (authCode.client_id !== client_id) {
      throw new BadRequestException('Client ID mismatch');
    }

    // Validate PKCE if required
    if (authCode.code_challenge) {
      const isValid = this.validatePKCE(
        code_verifier,
        authCode.code_challenge,
        authCode.code_challenge_method,
      );
      if (!isValid) {
        throw new BadRequestException('Invalid PKCE verification');
      }
    }

    // Generate tokens
    const tokens = this.jwtTokenService.generateTokenPair(
      authCode.user_id,
      client_id,
      'mcp:access',
    );

    // Remove the used authorization code
    this.store.removeAuthCode(code);

    return tokens;
  }

  private async handleRefreshTokenGrant(
    refresh_token: string,
  ): Promise<TokenPair> {
    const newTokens = this.jwtTokenService.refreshAccessToken(refresh_token);
    if (!newTokens) {
      throw new BadRequestException('Failed to refresh token');
    }

    return newTokens;
  }

  @Get('/validate')
  @UseGuards(JwtAuthGuard)
  validateToken(@Req() req: AuthenticatedRequest) {
    return {
      valid: true,
      user_id: req.user.sub,
      client_id: req.user.client_id,
      scope: req.user.scope,
      expires_at: req.user.exp! * 1000,
    };
  }

  private parseExpiresInToMs(expiresIn: string): number {
    // Handle formats like "60s", "30d", "24h", "1440m"
    const match = expiresIn.match(/^(\d+)([smhd]?)$/);
    if (!match) {
      throw new Error(`Invalid expiresIn format: ${expiresIn}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2] || 's'; // default to seconds

    const multipliers = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit as keyof typeof multipliers];
  }

  private validatePKCE(
    code_verifier: string,
    code_challenge: string,
    method: string,
  ): boolean {
    if (method === 'plain') {
      return code_verifier === code_challenge;
    } else if (method === 'S256') {
      const hash = createHash('sha256')
        .update(code_verifier)
        .digest('base64url');
      return hash === code_challenge;
    }
    return false;
  }
}
