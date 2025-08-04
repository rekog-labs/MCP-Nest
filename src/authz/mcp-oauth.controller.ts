import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Logger,
  Next,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { Request as ExpressRequest, NextFunction, Response } from 'express';
import passport from 'passport';
import { normalizeEndpoint } from '../mcp/utils/normalize-endpoint';
import {
  OAuthEndpointConfiguration,
  OAuthModuleOptions,
  OAuthSession,
  OAuthUserProfile,
} from './providers/oauth-provider.interface';
import { ClientService } from './services/client.service';
import { JwtTokenService, TokenPair } from './services/jwt-token.service';
import { STRATEGY_NAME } from './services/oauth-strategy.service';
import { IOAuthStore } from './stores/oauth-store.interface';

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
    readonly logger = new Logger(McpOAuthController.name);
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

    @Get(endpoints.wellKnownProtectedResourceMetadata)
    getProtectedResourceMetadata() {
      // The issuer URL of your authorization server.
      const authorizationServerIssuer = this.options.jwtIssuer;

      // The canonical URI of the MCP server resource itself.
      const resourceIdentifier = this.options.resource;

      const metadata = {
        /**
         * REQUIRED by MCP Spec.
         * A list of authorization server issuer URLs that can issue tokens for this resource.
         */
        authorization_servers: [authorizationServerIssuer],

        /**
         * RECOMMENDED by RFC 9728.
         * The identifier for this resource server.
         */
        resource: resourceIdentifier,

        /**
         * RECOMMENDED by RFC 9728.
         * A list of scopes that this resource server understands.
         */
        scopes_supported:
          this.options.protectedResourceMetadata.scopesSupported,

        /**
         * RECOMMENDED by RFC 9728.
         * A list of methods clients can use to present the access token.
         */
        bearer_methods_supported:
          this.options.protectedResourceMetadata.bearerMethodsSupported,

        /**
         * OPTIONAL but helpful custom metadata.
         * Declares which version of the MCP spec this server supports.
         */
        mcp_versions_supported:
          this.options.protectedResourceMetadata.mcpVersionsSupported,
      };

      return metadata;
    }

    // OAuth endpoints
    @Get(endpoints.wellKnownAuthorizationServerMetadata)
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
        response_types_supported:
          this.options.authorizationServerMetadata.responseTypesSupported,
        response_modes_supported:
          this.options.authorizationServerMetadata.responseModesSupported,
        grant_types_supported:
          this.options.authorizationServerMetadata.grantTypesSupported,
        token_endpoint_auth_methods_supported:
          this.options.authorizationServerMetadata
            .tokenEndpointAuthMethodsSupported,
        scopes_supported:
          this.options.authorizationServerMetadata.scopesSupported,
        revocation_endpoint: normalizeEndpoint(
          `${this.serverUrl}/${endpoints?.revoke}`,
        ),
        code_challenge_methods_supported:
          this.options.authorizationServerMetadata
            .codeChallengeMethodsSupported,
      };
    }

    @Post(endpoints.register)
    async registerClient(@Body() registrationDto: any) {
      return await this.clientService.registerClient(registrationDto);
    }

    @Get(endpoints.authorize)
    async authorize(
      @Query() query: any,
      @Req()
      req: any,
      @Res() res: Response,
      @Next() next: NextFunction,
    ) {
      const {
        response_type,
        client_id,
        redirect_uri,
        code_challenge,
        code_challenge_method,
        state,
        scope,
      } = query;
      const resource = this.options.resource;
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
        scope: scope,
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
              this.logger.error('OAuth callback error:', err);
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
        resource: session.resource,
        scope: session.scope,
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
    async exchangeToken(
      @Body() body: any,
      @Req() req: any,
      @Res() res: Response,
    ): Promise<Response> {
      const { grant_type, code, code_verifier, redirect_uri, refresh_token } =
        body;

      let tokens: TokenPair;

      switch (grant_type) {
        case 'authorization_code': {
          // Extract client credentials based on authentication method
          const clientCredentials = this.extractClientCredentials(req, body);
          tokens = await this.handleAuthorizationCodeGrant(
            code,
            code_verifier,
            redirect_uri,
            clientCredentials,
          );
          break;
        }
        case 'refresh_token': {
          // For refresh tokens, try to extract client credentials, but allow fallback to token-based extraction
          let clientCredentials: { client_id: string; client_secret?: string };
          try {
            clientCredentials = this.extractClientCredentials(req, body);
          } catch {
            // If we can't extract credentials, we'll try to get them from the refresh token
            clientCredentials = { client_id: '' }; // Will be filled from token
          }
          tokens = await this.handleRefreshTokenGrant(
            refresh_token,
            clientCredentials,
          );
          break;
        }
        default:
          throw new BadRequestException('Unsupported grant_type');
      }

      // Set OAuth 2.0 token endpoint response headers
      res.contentType('application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');

      return res.status(200).json(tokens);
    }

    /**
     * Extract client credentials from request based on authentication method
     */
    extractClientCredentials(
      req: any,
      body: any,
    ): { client_id: string; client_secret?: string } {
      // Try client_secret_basic first (Authorization header)
      const authHeader = req.headers?.authorization;
      if (authHeader && authHeader.startsWith('Basic ')) {
        const credentials = Buffer.from(authHeader.slice(6), 'base64').toString(
          'utf-8',
        );
        const [client_id, client_secret] = credentials.split(':', 2);
        if (client_id) {
          return { client_id, client_secret };
        }
      }

      // Try client_secret_post (body parameters)
      if (body.client_id) {
        return {
          client_id: body.client_id,
          client_secret: body.client_secret,
        };
      }

      throw new BadRequestException('Missing client credentials');
    }

    /**
     * Validate client authentication based on the client's configured method
     */
    validateClientAuthentication(
      client: any,
      clientCredentials: { client_id: string; client_secret?: string },
    ): void {
      if (!client) {
        throw new BadRequestException('Invalid client_id');
      }

      const { token_endpoint_auth_method } = client;

      switch (token_endpoint_auth_method) {
        case 'client_secret_basic':
        case 'client_secret_post':
          if (!clientCredentials.client_secret) {
            throw new BadRequestException(
              'Client secret required for this authentication method',
            );
          }
          if (client.client_secret !== clientCredentials.client_secret) {
            throw new BadRequestException('Invalid client credentials');
          }
          break;

        case 'none':
          // Public client - no secret required
          if (clientCredentials.client_secret) {
            throw new BadRequestException(
              'Client secret not allowed for public clients',
            );
          }
          break;

        default:
          throw new BadRequestException(
            `Unsupported authentication method: ${token_endpoint_auth_method}`,
          );
      }
    }

    async handleAuthorizationCodeGrant(
      code: string,
      code_verifier: string,
      _redirect_uri: string,
      clientCredentials: { client_id: string; client_secret?: string },
    ): Promise<TokenPair> {
      this.logger.debug('handleAuthorizationCodeGrant - Params:', {
        code,
        client_id: clientCredentials.client_id,
      });

      // Get and validate the authorization code
      const authCode = await this.store.getAuthCode(code);
      if (!authCode) {
        this.logger.error(
          'handleAuthorizationCodeGrant - Invalid authorization code:',
          code,
        );
        throw new BadRequestException('Invalid authorization code');
      }
      if (authCode.expires_at < Date.now()) {
        await this.store.removeAuthCode(code);
        this.logger.error(
          'handleAuthorizationCodeGrant - Authorization code expired:',
          code,
        );
        throw new BadRequestException('Authorization code has expired');
      }
      if (authCode.client_id !== clientCredentials.client_id) {
        this.logger.error(
          'handleAuthorizationCodeGrant - Client ID mismatch:',
          { expected: authCode.client_id, got: clientCredentials.client_id },
        );
        throw new BadRequestException('Client ID mismatch');
      }

      // Get client and validate authentication
      const client = await this.clientService.getClient(
        clientCredentials.client_id,
      );
      this.validateClientAuthentication(client, clientCredentials);
      if (authCode.code_challenge) {
        const isValid = this.validatePKCE(
          code_verifier,
          authCode.code_challenge,
          authCode.code_challenge_method,
        );
        if (!isValid) {
          this.logger.error(
            'handleAuthorizationCodeGrant - Invalid PKCE verification',
          );
          throw new BadRequestException('Invalid PKCE verification');
        }
      }
      if (!authCode.resource) {
        this.logger.error(
          'handleAuthorizationCodeGrant - No resource associated with code',
        );
        throw new BadRequestException(
          'Authorization code is not associated with a resource',
        );
      }

      const tokens = this.jwtTokenService.generateTokenPair(
        authCode.user_id,
        clientCredentials.client_id,
        authCode.scope,
        authCode.resource,
      );
      await this.store.removeAuthCode(code);
      this.logger.log(
        'handleAuthorizationCodeGrant - Token pair generated for user:',
        authCode.user_id,
      );
      return tokens;
    }

    async handleRefreshTokenGrant(
      refresh_token: string,
      clientCredentials: { client_id: string; client_secret?: string },
    ): Promise<TokenPair> {
      // Verify the refresh token first to get client_id from token if not provided
      const payload = this.jwtTokenService.validateToken(refresh_token);
      if (!payload || payload.type !== 'refresh') {
        throw new BadRequestException('Invalid or expired refresh token');
      }

      // Use client_id from token if not provided in credentials
      const clientId = clientCredentials.client_id || payload.client_id;
      if (!clientId) {
        throw new BadRequestException('Unable to determine client_id');
      }

      // Get client and validate authentication
      const client = await this.clientService.getClient(clientId);

      // For refresh token grants, we can be more lenient with client authentication
      // if the token already contains the client_id and the client is public
      if (client?.token_endpoint_auth_method !== 'none') {
        this.validateClientAuthentication(client, {
          ...clientCredentials,
          client_id: clientId,
        });
      }

      // Verify the refresh token belongs to the client
      if (payload.client_id !== clientId) {
        throw new BadRequestException(
          'Invalid refresh token or token does not belong to this client',
        );
      }

      const newTokens = this.jwtTokenService.refreshAccessToken(refresh_token);
      if (!newTokens) {
        throw new BadRequestException('Failed to refresh token');
      }

      return newTokens;
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
