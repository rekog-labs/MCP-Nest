import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Logger,
  Next,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import type {
  Request as ExpressRequest,
  NextFunction,
  Response,
} from 'express';
import passport from 'passport';
import { normalizeEndpoint } from '@rekog/mcp-nest';
import type {
  OAuthEndpointConfiguration,
  OAuthModuleOptions,
  OAuthSession,
  OAuthUserProfile,
} from './providers/oauth-provider.interface';
import { ClientIdMetadataService } from './services/client-id-metadata.service';
import { ClientService } from './services/client.service';
import { ConsentService } from './services/consent.service';
import { JwtTokenService, TokenPair } from './services/jwt-token.service';
import { OAuthStrategyService } from './services/oauth-strategy.service';
import { ScopePolicyService } from './services/scope-policy.service';
import type { IOAuthStore, OAuthClient } from './stores/oauth-store.interface';

interface OAuthCallbackRequest extends ExpressRequest {
  user?: {
    profile: OAuthUserProfile;
    accessToken: string;
    provider: string;
  };
}

// Add this interface to properly type the Express request with raw body
interface RequestWithRawBody extends ExpressRequest {
  rawBody?: Buffer;
  textBody?: string;
}

export function createMcpOAuthController(
  endpoints: OAuthEndpointConfiguration = {},
  options?: {
    disableWellKnownProtectedResourceMetadata?: boolean;
    disableWellKnownAuthorizationServerMetadata?: boolean;
    disableRegister?: boolean;
    /**
     * Registers `POST <endpoints.consent>`. Route registration happens when the
     * controller class is built, so this cannot be read off the module options at
     * request time — with consent off the route does not exist at all.
     */
    consentEnabled?: boolean;
  },
  authModuleId?: string,
) {
  // Optional decorator helpers
  const OptionalGet = (
    path: string | string[] | undefined,
    enabled: boolean,
  ): MethodDecorator => {
    return enabled && path
      ? (Get as unknown as (p?: any) => MethodDecorator)(path)
      : ((() => {}) as unknown as MethodDecorator);
  };
  const OptionalPost = (
    path: string | string[] | undefined,
    enabled: boolean,
  ): MethodDecorator => {
    return enabled && path
      ? (Post as unknown as (p?: any) => MethodDecorator)(path)
      : ((() => {}) as unknown as MethodDecorator);
  };
  const OptionalHeader = (
    name: string,
    value: string,
    enabled: boolean,
  ): MethodDecorator => {
    return enabled
      ? (Header as unknown as (n: string, v: string) => MethodDecorator)(
          name,
          value,
        )
      : ((() => {}) as unknown as MethodDecorator);
  };

  @Controller()
  class McpOAuthController {
    readonly logger = new Logger(McpOAuthController.name);
    readonly serverUrl: string;
    readonly isProduction: boolean;
    readonly options: OAuthModuleOptions;
    readonly strategyName: string;

    constructor(
      @Inject(
        authModuleId
          ? `OAUTH_MODULE_OPTIONS_${authModuleId}`
          : 'OAUTH_MODULE_OPTIONS',
      )
      options: OAuthModuleOptions,
      @Inject(authModuleId ? `IOAuthStore_${authModuleId}` : 'IOAuthStore')
      readonly store: IOAuthStore,
      readonly jwtTokenService: JwtTokenService,
      readonly clientService: ClientService,
      readonly oauthStrategyService: OAuthStrategyService,
      readonly scopePolicy: ScopePolicyService,
      readonly consent: ConsentService,
      readonly clientIdMetadata: ClientIdMetadataService,
    ) {
      this.serverUrl = options.serverUrl;
      this.isProduction = options.cookieSecure;
      this.options = options;
      this.strategyName = oauthStrategyService.getStrategyName();
    }

    /**
     * Utility function to parse form-encoded or JSON bodies
     * Handles both string (raw form data) and object bodies
     */
    parseRequestBody(body: any, req?: RequestWithRawBody): Record<string, any> {
      // If body is already a parsed object with properties, return it
      if (body && typeof body === 'object' && Object.keys(body).length > 0) {
        return body;
      }

      // If body is a string (raw form data), parse it
      if (typeof body === 'string' && body.length > 0) {
        const params = new URLSearchParams(body);
        const parsedBody: Record<string, any> = {};
        for (const [key, value] of params.entries()) {
          parsedBody[key] = value;
        }
        return parsedBody;
      }

      // Check if we have a text body stored on the request (from our middleware)
      if (req?.textBody) {
        const params = new URLSearchParams(req.textBody);
        const parsedBody: Record<string, any> = {};
        for (const [key, value] of params.entries()) {
          parsedBody[key] = value;
        }
        return parsedBody;
      }

      // Check if we have a raw body buffer stored on the request
      if (req?.rawBody) {
        const bodyString = req.rawBody.toString('utf-8');
        if (bodyString) {
          const params = new URLSearchParams(bodyString);
          const parsedBody: Record<string, any> = {};
          for (const [key, value] of params.entries()) {
            parsedBody[key] = value;
          }
          return parsedBody;
        }
      }

      // Return empty object if no valid body
      return {};
    }

    /**
     * Middleware to capture raw body for form-encoded requests
     * This is needed when bodyParser is disabled in the main app
     */
    captureRawBody(req: RequestWithRawBody, res: Response, next: NextFunction) {
      if (
        req.headers['content-type']?.includes(
          'application/x-www-form-urlencoded',
        )
      ) {
        let rawBody = '';

        req.on('data', (chunk: Buffer) => {
          rawBody += chunk.toString('utf-8');
        });

        req.on('end', () => {
          req.textBody = rawBody;
          // Also parse and set it as body for NestJS
          if (rawBody) {
            const params = new URLSearchParams(rawBody);
            const parsedBody: any = {};
            for (const [key, value] of params.entries()) {
              parsedBody[key] = value;
            }
            (req as any).body = parsedBody;
          }
          next();
        });

        req.on('error', (err) => {
          this.logger.error('Error reading request body:', err);
          next(err);
        });
      } else {
        next();
      }
    }

    @OptionalGet(
      endpoints.wellKnownProtectedResourceMetadata,
      !options?.disableWellKnownProtectedResourceMetadata,
    )
    @OptionalHeader(
      'content-type',
      'application/json',
      !options?.disableWellKnownProtectedResourceMetadata,
    )
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
         *
         * Omitted entirely when nothing is configured (the default), rather than
         * sent as `[]`: an empty list asserts "this resource understands no
         * scopes", which is not what an unconfigured server means. Note the
         * `2026-07-28` SHOULD NOT — do not put `offline_access` in here; it is
         * an authorization-server scope, not a resource requirement.
         */
        ...(this.options.protectedResourceMetadata.scopesSupported.length > 0
          ? {
              scopes_supported:
                this.options.protectedResourceMetadata.scopesSupported,
            }
          : {}),

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
    @OptionalGet(
      endpoints.wellKnownAuthorizationServerMetadata,
      !options?.disableWellKnownAuthorizationServerMetadata,
    )
    @OptionalHeader(
      'content-type',
      'application/json',
      !options?.disableWellKnownAuthorizationServerMetadata,
    )
    getAuthorizationServerMetadata() {
      return {
        /**
         * The canonical issuer. Identical to `serverUrl` (enforced at bootstrap),
         * because a client MUST NOT use a metadata document whose `issuer`
         * differs from the identifier it built this well-known URL from.
         */
        issuer: this.options.jwtIssuer,
        authorization_endpoint: normalizeEndpoint(
          `${this.serverUrl}/${endpoints.authorize}`,
        ),
        token_endpoint: normalizeEndpoint(
          `${this.serverUrl}/${endpoints.token}`,
        ),
        /**
         * RFC 7591 DCR. Still advertised by default — the `2026-07-28`
         * deprecation keeps it a `MAY` and clients that cannot use Client ID
         * Metadata Documents rely on it. Omitted only when the operator turned
         * the route off with `disableEndpoints: { register: true }`, because
         * advertising an endpoint that answers `404` is worse than advertising
         * none.
         */
        ...(options?.disableRegister
          ? {}
          : {
              registration_endpoint: normalizeEndpoint(
                `${this.serverUrl}/${endpoints.register}`,
              ),
            }),
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
        code_challenge_methods_supported:
          this.options.authorizationServerMetadata
            .codeChallengeMethodsSupported,

        /**
         * RFC 9207. MUST be advertised because we do emit `iss` on both the
         * success and the redirect-mode error response — never emit one without
         * the other, or a client cannot tell whether its absence is meaningful.
         */
        authorization_response_iss_parameter_supported: true,

        /**
         * Client ID Metadata Documents. Advertised only when actually enabled:
         * clients are told to prefer CIMD over Dynamic Client Registration
         * whenever they see this flag, so advertising it on a server that then
         * rejects every URL `client_id` would push them into a dead end instead
         * of the working `registration_endpoint` right next to it. The key is
         * omitted rather than sent as `false`, matching how absence is defined to
         * mean "unsupported".
         */
        ...(this.options.clientIdMetadataDocuments.enabled
          ? { client_id_metadata_document_supported: true }
          : {}),
      };
    }

    /**
     * Dynamic Client Registration (RFC 7591). **Deprecated** in protocol
     * revision `2026-07-28` (spec PR #2858) in favour of Client ID Metadata
     * Documents, but still a `MAY` and fully supported here — the feature
     * lifecycle policy puts the earliest possible removal at the first revision
     * released on or after 2027-07-28. Turn the route off with
     * `disableEndpoints: { register: true }` if your deployment only serves
     * pre-registered clients.
     */
    @OptionalPost(endpoints.register, !options?.disableRegister)
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

      // Failures up to and including redirect-URI validation must NOT redirect
      // (RFC 6749 §4.1.2.1) — the redirect target isn't trusted yet, so an
      // attacker could use us to bounce errors anywhere. They stay HTTP 400s.
      if (!client_id) {
        throw new BadRequestException('Missing required parameters');
      }

      // Validate client and redirect URI.
      //
      // For a Client ID Metadata Document client this is where the document is
      // fetched, and `getClient` throws (rather than returning null) with the
      // specific reason: bad URL shape, SSRF-refused destination, unreachable
      // origin, `client_id` mismatch, missing field, forbidden auth method. All
      // of those land here as an HTTP 400, which is what the draft's "SHOULD
      // abort the authorization request" means for a client_id we cannot trust.
      const client = await this.clientService.getClient(client_id);
      if (!client) {
        throw new BadRequestException('Invalid client_id');
      }

      // Was `clientService.validateRedirectUri(client_id, redirect_uri)`, which
      // re-resolved the client. Identical comparison, but done against the record
      // already in hand so a CIMD document is not fetched twice per authorization
      // request. This is the "MUST validate redirect URIs presented in an
      // authorization request against those in the metadata document" check —
      // exact match, no prefix or wildcard matching.
      if (!redirect_uri || !client.redirect_uris.includes(redirect_uri)) {
        throw new BadRequestException('Invalid redirect_uri');
      }

      // From here the redirect URI is known-good, so authorization failures go
      // back to the client on it with `error=`/`state=`/`iss=`.
      if (response_type !== 'code') {
        this.redirectAuthorizationError(
          res,
          redirect_uri,
          'unsupported_response_type',
          'Only response_type=code is supported',
          state,
        );
        return;
      }

      // PKCE is mandatory (OAuth 2.1 §4.1.1, RFC 7636), and only S256 counts:
      // `plain` puts the verifier itself in the authorization request, so
      // anything that can observe the request — browser history, a proxy log,
      // the redirect chain — can replay an intercepted code. Both failures are
      // post-validation, so per RFC 6749 §4.1.2.1 they go back on the
      // now-trusted redirect URI instead of being 400s the client never sees.
      if (this.options.requirePkce) {
        if (!code_challenge) {
          this.redirectAuthorizationError(
            res,
            redirect_uri,
            'invalid_request',
            'code_challenge is required (PKCE with code_challenge_method=S256)',
            state,
          );
          return;
        }
        // RFC 7636 §4.3: an absent method means `plain`, so a challenge with no
        // declared method is a downgrade attempt as much as an explicit one.
        if ((code_challenge_method ?? 'plain') !== 'S256') {
          this.redirectAuthorizationError(
            res,
            redirect_uri,
            'invalid_request',
            'Only code_challenge_method=S256 is supported',
            state,
          );
          return;
        }
      }

      // Narrow the grant before it is recorded anywhere, so the session, the
      // authorization code and the token claim all agree on what was actually
      // granted rather than on what was asked for.
      const grantedScope = this.scopePolicy.narrow(scope);

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
        scope: grantedScope,
        resource,
        expiresAt: Date.now() + this.options.oauthSessionExpiresIn,
        // Pin the document for the rest of the flow instead of re-fetching it
        // when the code is minted and again when it is redeemed. Two reasons:
        // the consent screen and the redemption then agree with each other by
        // construction, and a document that changes mid-flow (a swapped
        // `redirect_uris`, a different `token_endpoint_auth_method`) cannot
        // retroactively alter a grant the user already approved.
        ...(this.clientIdMetadata.isMetadataDocumentClientId(client_id)
          ? { clientMetadata: client }
          : {}),
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
      passport.authenticate(this.strategyName, {
        state: req.cookies?.oauth_state,
      })(req, res, next);
    }

    /**
     * Return an authorization error to the client on its (already validated)
     * redirect URI, per RFC 6749 §4.1.2.1, carrying the RFC 9207 `iss` so the
     * client can tell which authorization server answered — mixed-up-issuer
     * protection works on error responses too, not just successful ones.
     */
    redirectAuthorizationError(
      res: Response,
      redirectUri: string,
      error: string,
      description: string,
      state?: string,
    ) {
      const url = new URL(redirectUri);
      url.searchParams.set('error', error);
      url.searchParams.set('error_description', description);
      if (state) {
        url.searchParams.set('state', state);
      }
      url.searchParams.set('iss', this.options.jwtIssuer);
      res.redirect(url.toString());
    }

    @Get(endpoints.callback)
    handleProviderCallback(
      @Req() req: OAuthCallbackRequest,
      @Res() res: Response,
      @Next() next: NextFunction,
    ) {
      // Use a custom callback to handle the authentication result
      passport.authenticate(
        this.strategyName,
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

      // The passport state cookie has served its purpose either way.
      res.clearCookie('oauth_state');

      // Persist user profile and get stable profile_id
      const user_profile_id = await this.store.upsertUserProfile(
        user.profile,
        user.provider,
      );

      // The consent gate. It sits *here* — after the IdP round-trip, before the
      // code exists — for two reasons: there is no authenticated principal to
      // record a grant against any earlier, and the spec wants the redirect-URI
      // hostname shown "during authorization", which stops being true once the
      // code has been minted and the browser is already on its way back to the
      // client.
      if (
        this.consent.isEnabled() &&
        !this.consent.hasConsent(
          user_profile_id,
          session.clientId!,
          session.scope,
        )
      ) {
        await this.renderConsentScreen(
          session,
          user.profile,
          user_profile_id,
          res,
        );
        return;
      }

      // Clear temporary cookies
      res.clearCookie('oauth_session');

      await this.issueAuthorizationCode(
        session,
        user.profile.username,
        user_profile_id,
        res,
      );
    }

    /**
     * Mint the authorization code and hand it back on the client's redirect URI.
     *
     * Extracted from `processAuthenticationSuccess` so the direct path and the
     * consent-approved path cannot drift: whatever the code is bound to (PKCE
     * challenge, resource, narrowed scope, CIMD snapshot) is bound identically in
     * both, and the RFC 9207 `iss` is emitted from one place.
     */
    async issueAuthorizationCode(
      session: OAuthSession,
      userId: string,
      userProfileId: string,
      res: Response,
    ) {
      const authCode = randomBytes(32).toString('base64url');

      await this.store.storeAuthCode({
        code: authCode,
        user_id: userId,
        client_id: session.clientId!,
        redirect_uri: session.redirectUri!,
        code_challenge: session.codeChallenge!,
        code_challenge_method: session.codeChallengeMethod!,
        expires_at: Date.now() + this.options.authCodeExpiresIn,
        resource: session.resource,
        scope: session.scope,
        user_profile_id: userProfileId,
        // Present for CIMD clients only; the token endpoint prefers it over a
        // fresh fetch. See `AuthorizationCode.client_metadata`.
        ...(session.clientMetadata
          ? { client_metadata: session.clientMetadata }
          : {}),
      });

      // Build redirect URL with authorization code
      const redirectUrl = new URL(session.redirectUri!);
      redirectUrl.searchParams.set('code', authCode);
      if (session.oauthState) {
        redirectUrl.searchParams.set('state', session.oauthState);
      }
      // RFC 9207 / SEP-2468: name the issuer so a client running several
      // authorization servers cannot be tricked into redeeming this code at the
      // wrong one. Advertised as `authorization_response_iss_parameter_supported`.
      redirectUrl.searchParams.set('iss', this.options.jwtIssuer);

      // Clean up session
      await this.store.removeOAuthSession(session.sessionId);

      res.redirect(redirectUrl.toString());
    }

    /**
     * Park the authenticated principal on the session and answer with the consent
     * page.
     *
     * `POST /consent` is a fresh request with no passport state, so the user has
     * to survive on the session — which is also why the `oauth_session` cookie is
     * kept here instead of being cleared as it is on the direct path.
     */
    async renderConsentScreen(
      session: OAuthSession,
      profile: OAuthUserProfile,
      userProfileId: string,
      res: Response,
    ) {
      await this.store.storeOAuthSession(session.sessionId, {
        ...session,
        consentPending: true,
        userId: profile.username,
        userProfileId,
      });

      const client =
        session.clientMetadata ??
        (await this.clientService.getClient(session.clientId!));
      if (!client) {
        throw new BadRequestException('Invalid client_id');
      }

      const html = await this.consent.render({
        client,
        clientId: session.clientId!,
        isMetadataDocumentClient: this.clientIdMetadata.isMetadataDocumentClientId(
          session.clientId!,
        ),
        redirectUri: session.redirectUri!,
        // The MUST: "authorization servers ... MUST clearly display the redirect
        // URI hostname during authorization".
        redirectUriHost: hostnameOf(session.redirectUri!),
        isLoopbackRedirect: this.consent.isLoopbackRedirect(
          session.redirectUri!,
        ),
        isLoopbackOnlyClient: client.redirect_uris.every((uri) =>
          this.consent.isLoopbackRedirect(uri),
        ),
        scopes: (session.scope ?? '').split(/\s+/).filter(Boolean),
        user: profile,
        // Absolute path. `endpoints.*` are stored without a leading slash (that
        // is what `normalizeEndpoint` produces), so one is put back here — a
        // relative action would resolve against `/callback` and 404.
        formAction: `/${normalizeEndpoint(endpoints.consent ?? '')}`,
        // The session `state` is already a 32-byte random value that only ever
        // travels in httpOnly cookies, so it doubles as the CSRF token: a
        // cross-site form cannot read it, and without it `POST /consent` refuses.
        csrfToken: session.state,
      });

      res
        .status(200)
        .type('html')
        // A consent decision must never be replayed from a cache, and the page
        // names the user, so no intermediary should store it either.
        .set('cache-control', 'no-store')
        .send(html);
    }

    /**
     * The user's decision. Only registered when consent is enabled.
     *
     * Not a `GET`: approving is a state change (it mints an authorization code),
     * so it must not be reachable by a link, a prefetch or an image tag.
     */
    @OptionalPost(endpoints.consent, !!options?.consentEnabled)
    async submitConsent(
      @Body() body: any,
      @Req() req: RequestWithRawBody,
      @Res() res: Response,
    ) {
      const parsed = this.parseRequestBody(body, req);

      const sessionId = req.cookies?.oauth_session as string | undefined;
      if (!sessionId) {
        throw new BadRequestException('Missing OAuth session');
      }
      const session = await this.store.getOAuthSession(sessionId);
      if (!session?.consentPending || !session.userProfileId) {
        throw new BadRequestException(
          'No consent decision is pending for this session',
        );
      }

      // CSRF. Without this check, a page on any other origin could POST here with
      // the user's ambient cookies and silently approve a grant.
      if (
        typeof parsed.consent_token !== 'string' ||
        parsed.consent_token !== session.state
      ) {
        throw new BadRequestException('Invalid consent token');
      }

      const approved = parsed.approve === 'true';
      this.consent.logDecision(
        approved,
        session.userProfileId,
        session.clientId!,
        session.redirectUri!,
      );

      res.clearCookie('oauth_session');

      if (!approved) {
        await this.store.removeOAuthSession(sessionId);
        // RFC 6749 §4.1.2.1: "access_denied — The resource owner or authorization
        // server denied the request." The redirect URI was validated back at
        // /authorize, so the refusal belongs on it rather than in a 400 the
        // client never sees.
        this.redirectAuthorizationError(
          res,
          session.redirectUri!,
          'access_denied',
          'The user denied the authorization request',
          session.oauthState,
        );
        return;
      }

      this.consent.recordConsent(
        session.userProfileId,
        session.clientId!,
        session.scope,
      );

      await this.issueAuthorizationCode(
        session,
        session.userId!,
        session.userProfileId,
        res,
      );
    }

    @Post(endpoints.token)
    @Header('content-type', 'application/json')
    @Header('Cache-Control', 'no-store')
    @Header('Pragma', 'no-cache')
    @HttpCode(200)
    async exchangeToken(
      @Body() body: any,
      @Req() req: RequestWithRawBody,
      @Res({ passthrough: true }) res: Response,
    ): Promise<TokenPair> {
      // Apply middleware to capture raw body if needed
      const isFormUrlEncoded = req.headers['content-type']?.includes(
        'application/x-www-form-urlencoded',
      );
      const isBodyEmpty =
        !body ||
        (typeof body === 'object' &&
          Object.keys(body as Record<string, unknown>).length === 0);

      if (isFormUrlEncoded && isBodyEmpty) {
        return new Promise((resolve, reject) => {
          this.captureRawBody(req, res, (err?: any) => {
            if (err) {
              reject(
                err instanceof Error ? err : new Error(String(err ?? 'error')),
              );
              return;
            }

            // Avoid returning a Promise from the callback; use an IIFE
            void (async () => {
              try {
                // Re-parse the body after middleware has captured it
                const parsedBody = this.parseRequestBody(req.body || body, req);
                const result = await this.processTokenExchange(parsedBody, req);
                resolve(result);
              } catch (error) {
                reject(
                  error instanceof Error
                    ? error
                    : new Error(String(error ?? 'error')),
                );
              }
            })();
          });
        });
      }

      // Body is already parsed, process directly
      const parsedBody = this.parseRequestBody(body, req);
      return this.processTokenExchange(parsedBody, req);
    }

    async processTokenExchange(
      parsedBody: Record<string, any>,
      req: RequestWithRawBody,
    ): Promise<TokenPair> {
      const { grant_type, code, code_verifier, redirect_uri, refresh_token } =
        parsedBody;

      // Add debugging to help identify issues
      if (!grant_type) {
        this.logger.error('Missing grant_type in request body:', {
          parsedBodyKeys: Object.keys(parsedBody),
          contentType: req.headers['content-type'],
          textBody: req.textBody,
          parsedBody,
        });
        throw new BadRequestException('Missing grant_type parameter');
      }

      switch (grant_type) {
        case 'authorization_code': {
          // Extract client credentials based on authentication method
          const clientCredentials = this.extractClientCredentials(
            req,
            parsedBody,
          );
          return await this.handleAuthorizationCodeGrant(
            typeof code === 'string' ? code : String(code ?? ''),
            typeof code_verifier === 'string'
              ? code_verifier
              : String(code_verifier ?? ''),
            typeof redirect_uri === 'string'
              ? redirect_uri
              : String(redirect_uri ?? ''),
            clientCredentials,
          );
        }
        case 'refresh_token': {
          // For refresh tokens, try to extract client credentials, but allow fallback to token-based extraction
          let clientCredentials: { client_id: string; client_secret?: string };
          try {
            clientCredentials = this.extractClientCredentials(req, parsedBody);
          } catch {
            // If we can't extract credentials, we'll try to get them from the refresh token
            clientCredentials = { client_id: '' }; // Will be filled from token
          }
          return await this.handleRefreshTokenGrant(
            typeof refresh_token === 'string'
              ? refresh_token
              : String(refresh_token ?? ''),
            clientCredentials,
          );
        }
        default:
          throw new BadRequestException(
            `Unsupported grant_type: ${grant_type}`,
          );
      }
    }

    /**
     * Extract client credentials from request based on authentication method
     */
    extractClientCredentials(
      req: RequestWithRawBody,
      body: any,
    ): { client_id: string; client_secret?: string } {
      // Parse the body using the shared utility function
      const parsedBody = this.parseRequestBody(body, req);

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
      if (parsedBody.client_id) {
        return {
          client_id: parsedBody.client_id,
          client_secret: parsedBody.client_secret,
        };
      }

      throw new BadRequestException('Missing client credentials');
    }

    /**
     * Validate client authentication based on the client's configured method.
     *
     * A Client ID Metadata Document client always arrives here as
     * `token_endpoint_auth_method: 'none'` — a public client, redeeming with PKCE
     * and no secret. That is enforced upstream in
     * `ClientIdMetadataService.validateDocument`, which refuses a document
     * declaring anything else (`private_key_jwt` included) at `/authorize`, so the
     * `default:` branch below is not the place a CIMD client discovers it is
     * unsupported — it would already hold an authorization code by then.
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

      // Get client and validate authentication.
      //
      // A CIMD code carries its document with it: redeeming it is validated
      // against the snapshot taken at /authorize, not against a fresh fetch. That
      // pins the redemption to what the user consented to, and means the token
      // endpoint neither depends on the client's origin still being reachable nor
      // gives it a second chance to change `token_endpoint_auth_method` after the
      // code was issued.
      const client: OAuthClient | null =
        authCode.client_metadata ??
        (await this.clientService.getClient(clientCredentials.client_id));
      this.validateClientAuthentication(client, clientCredentials);

      // The PKCE check must not be skippable. Verification used to run only
      // `if (authCode.code_challenge)`, so a code minted without a challenge —
      // which `/authorize` now refuses, but a custom store, a code issued before
      // this version, or a future code path could still produce — was redeemed
      // with no proof of possession at all. Under `requirePkce` an S256-bound
      // challenge is a precondition for redemption, checked before the verifier
      // is even looked at.
      if (
        this.options.requirePkce &&
        (!authCode.code_challenge || authCode.code_challenge_method !== 'S256')
      ) {
        this.logger.error(
          'handleAuthorizationCodeGrant - Authorization code is not bound to an S256 PKCE challenge',
        );
        throw new BadRequestException(
          'Authorization code is not bound to an S256 PKCE challenge',
        );
      }
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

      let userData: Record<string, unknown> | undefined = undefined;
      if (authCode.user_profile_id) {
        try {
          const profile = await this.store.getUserProfileById(
            authCode.user_profile_id,
          );
          if (profile) {
            // Avoid circular/large raw payloads if present
            userData = { ...profile };
          }
        } catch (e) {
          this.logger.warn('Failed to load user profile for token payload', e);
        }
      }

      const tokens = this.jwtTokenService.generateTokenPair(
        authCode.user_id,
        clientCredentials.client_id,
        authCode.scope,
        authCode.resource,
        {
          user_profile_id: authCode.user_profile_id,
          user_data: userData,
        },
      );
      await this.store.removeAuthCode(code);
      this.logger.debug(
        'handleAuthorizationCodeGrant - Token pair generated for user:',
        authCode.user_id,
      );
      return tokens;
    }

    async handleRefreshTokenGrant(
      refresh_token: string,
      clientCredentials: { client_id: string; client_secret?: string },
    ): Promise<TokenPair> {
      // Verify the refresh token first to get client_id from token if not
      // provided. The expectations are what stop an *access* token — same
      // secret, same issuer — from being redeemed here, and what stops a
      // refresh token minted for a sibling resource from being usable.
      const payload = this.jwtTokenService.validateToken(refresh_token, {
        type: 'refresh',
        audience: this.options.resource,
      });
      if (!payload) {
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

      let newTokens: TokenPair | null = null;
      try {
        let userData: Record<string, unknown> | undefined = undefined;
        if (payload.user_profile_id) {
          try {
            const profile = await this.store.getUserProfileById(
              payload.user_profile_id,
            );
            if (profile) userData = { ...profile };
          } catch (e) {
            this.logger.warn(
              'Failed to load user profile for refreshed token payload',
              e,
            );
          }
        }

        newTokens = this.jwtTokenService.generateTokenPair(
          payload.sub,
          clientId,
          payload.scope,
          payload.resource,
          {
            user_profile_id: payload.user_profile_id,
            user_data: userData,
          },
        );
      } catch (e) {
        this.logger.warn(
          'Refresh flow failed using enriched path, fallback',
          e,
        );
        newTokens = this.jwtTokenService.refreshAccessToken(refresh_token);
      }

      if (!newTokens) throw new BadRequestException('Failed to refresh token');
      return newTokens;
    }

    /**
     * `plain` is still implemented, but under the default `requirePkce: true` it
     * is unreachable: `/authorize` refuses to mint a `plain`-bound code and
     * `handleAuthorizationCodeGrant` refuses to redeem one. It exists for the
     * `requirePkce: false` migration window only.
     */
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

/**
 * Hostname of a redirect URI, for the consent screen's mandatory display. Falls
 * back to the raw string rather than throwing: a redirect URI that reached this
 * point already matched the client's registered list exactly, so if it does not
 * parse the honest thing is to show the user what is actually there.
 */
function hostnameOf(uri: string): string {
  try {
    return new URL(uri).hostname || uri;
  } catch {
    return uri;
  }
}
