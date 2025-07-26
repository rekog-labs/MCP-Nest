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
  OAuthEndpointConfiguration,
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
import { normalizeEndpoint } from '../mcp/utils/normalize-endpoint';

interface OAuthCallbackRequest extends ExpressRequest {
  user?: {
    profile: OAuthUserProfile;
    accessToken: string;
    provider: string;
  };
}

export function createMcpOAuthController(
  endpoints: OAuthEndpointConfiguration = {},
) {
  @Controller()
  class McpOAuthController {
    readonly serverUrl: string;
    readonly isProduction: boolean;
    readonly options: OAuthModuleOptions;
    constructor(
      @Inject('OAUTH_MODULE_OPTIONS') options: OAuthModuleOptions,
      @Inject('IOAuthStore') readonly store: IOAuthStore,
      readonly jwtTokenService: JwtTokenService,
      readonly clientService: ClientService,
    ) {
      this.serverUrl = options.serverUrl;
      this.isProduction = options.cookieSecure;
      this.options = options;
    }

    // OAuth endpoints
    @Get(endpoints.wellKnown)
    getAuthorizationServerMetadata() {
      return {
        issuer: this.serverUrl,
        authorization_endpoint: normalizeEndpoint(
          `${this.serverUrl}/${endpoints.authorize}`,
        ),
        token_endpoint: normalizeEndpoint(
          `${this.serverUrl}/${endpoints.token}`,
        ),
        registration_endpoint: normalizeEndpoint(
          `${this.serverUrl}/${endpoints.register}`,
        ),
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: [
          'client_secret_basic',
          'client_secret_post',
          'none',
        ],
        revocation_endpoint: normalizeEndpoint(
          `${this.serverUrl}/${endpoints?.revoke}`,
        ),
        code_challenge_methods_supported: ['plain', 'S256'],
      };
    }

    @Post(endpoints.register)
    async registerClient(@Body() registrationDto: ClientRegistrationDto) {
      return await this.clientService.registerClient(registrationDto);
    }

    @Get(endpoints.authorize)
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

      if (!client_id) {
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

      await this.store.storeOAuthSession(sessionId, oauthSession);

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
      res.redirect(`/${endpoints.auth}`);
    }

    @Get(endpoints.auth)
    authenticate(
      @Req()
      req: any,
      @Res() res: Response,
      @Next() next: NextFunction,
    ) {
      passport.authenticate(STRATEGY_NAME, {
        state: req.cookies?.oauth_state,
      })(req, res, next);
    }

    @Get(endpoints.callback)
    handleProviderCallback(
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

    async processAuthenticationSuccess(
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
      if (!session) {
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
      await this.store.storeAuthCode({
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
      await this.store.removeOAuthSession(sessionId);

      res.redirect(redirectUrl.toString());
    }

    // Token endpoints (remain the same)
    @Post(endpoints.token)
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

    async handleAuthorizationCodeGrant(
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
      await this.store.removeAuthCode(code);

      return tokens;
    }

    handleRefreshTokenGrant(refresh_token: string): TokenPair {
      const newTokens = this.jwtTokenService.refreshAccessToken(refresh_token);
      if (!newTokens) {
        throw new BadRequestException('Failed to refresh token');
      }

      return newTokens;
    }

    @Get(endpoints.validate)
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

    validatePKCE(
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

  return McpOAuthController;
}
