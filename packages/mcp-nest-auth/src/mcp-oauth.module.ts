import { DynamicModule, Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { McpAuthJwtGuard } from './guards/jwt-auth.guard';
import { createMcpOAuthController } from './mcp-oauth.controller';
import type {
  OAuthUserModuleOptions as AuthUserModuleOptions,
  OAuthEndpointConfiguration,
  OAuthModuleDefaults,
  OAuthModuleOptions,
} from './providers/oauth-provider.interface';
import { ClientIdMetadataService } from './services/client-id-metadata.service';
import { ClientService } from './services/client.service';
import { ConsentService } from './services/consent.service';
import { CookieParserCheckService } from './services/cookie-parser-check.service';
import { JwtTokenService } from './services/jwt-token.service';
import { OAuthStrategyService } from './services/oauth-strategy.service';
import { ScopePolicyService } from './services/scope-policy.service';
import { MemoryStore } from './stores/memory-store.service';
import { normalizeEndpoint } from '@rekog/mcp-nest';
import { OAUTH_TYPEORM_CONNECTION_NAME } from './stores/typeorm/constants';

let authInstanceIdCounter = 0;

// Default configuration values
export const DEFAULT_OPTIONS: OAuthModuleDefaults = {
  serverUrl: 'http://localhost:3000',
  resource: 'http://localhost:3000/mcp',
  jwtIssuer: 'http://localhost:3000',
  jwtAudience: 'mcp-client',
  jwtAccessTokenExpiresIn: '1d',
  jwtRefreshTokenExpiresIn: '30d',
  enableRefreshTokens: true,
  cookieMaxAge: 24 * 60 * 60 * 1000, // 24 hours
  oauthSessionExpiresIn: 10 * 60 * 1000, // 10 minutes
  authCodeExpiresIn: 10 * 60 * 1000, // 10 minutes
  nodeEnv: 'development',
  apiPrefix: '',
  scopeValidation: 'strict',
  requirePkce: true,
  /**
   * Off by default. Enabling it inserts an interactive page into a chain that is
   * otherwise fully automatic, so no existing deployment should acquire it by
   * upgrading. Forced on when Client ID Metadata Documents are enabled — see
   * `mergeAndValidateOptions`.
   */
  consent: {
    enabled: false,
    rememberForMs: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  /**
   * Off by default: enabling it makes this server fetch a URL supplied by an
   * unauthenticated caller. That is a deliberate, guarded capability (see
   * `ClientIdMetadataService`), not something to acquire silently.
   */
  clientIdMetadataDocuments: {
    enabled: false,
    allowInsecureClientIdScheme: false,
    cacheTtlMs: 5 * 60 * 1000,
    maxCacheEntries: 256,
    timeoutMs: 5_000,
    // "The recommended maximum response size for client metadata documents is
    // 5 kilobytes" — draft-ietf-oauth-client-id-metadata-document-00.
    maxDocumentBytes: 5 * 1024,
  },
  endpoints: {
    wellKnownAuthorizationServerMetadata:
      '/.well-known/oauth-authorization-server',
    wellKnownProtectedResourceMetadata: '/.well-known/oauth-protected-resource',
    register: '/register',
    authorize: '/authorize',
    callback: '/callback',
    token: '/token',
    consent: '/consent',
  },
  disableEndpoints: {
    wellKnownAuthorizationServerMetadata: false,
    wellKnownProtectedResourceMetadata: false,
    register: false,
  },
  protectedResourceMetadata: {
    /**
     * Empty by default. Revision `2026-07-28` adds a SHOULD NOT against listing
     * `offline_access` here (or in `WWW-Authenticate`): refresh tokens are a
     * client/authorization-server concern, never something a *resource* needs,
     * so advertising it as a resource scope tells clients to ask for a
     * permission this resource does not define. It remains in
     * `authorizationServerMetadata.scopesSupported`, where it genuinely is a
     * grantable scope. List the scopes your `@ToolScopes()` tools require here
     * (or there) if you want them discoverable.
     */
    scopesSupported: [],
    bearerMethodsSupported: ['header'],
    /**
     * Matches the default transport posture, which serves both protocol eras
     * (`protocol: 'dual'`). Narrow this to a single revision if you pin the
     * endpoint with `protocol: 'legacy-only'` / `'modern-only'`.
     */
    mcpVersionsSupported: ['2026-07-28', '2025-06-18'],
  },
  authorizationServerMetadata: {
    responseTypesSupported: ['code'],
    responseModesSupported: ['query'],
    grantTypesSupported: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethodsSupported: [
      'client_secret_basic',
      'client_secret_post',
      'none',
    ],
    scopesSupported: ['offline_access'],
    /**
     * S256 only. OAuth 2.1 §4.1.1 requires PKCE and permits `plain` solely
     * where S256 is unavailable, which is never true of an MCP client;
     * advertising `plain` alongside it just invites a downgrade. `requirePkce:
     * false` does not put `plain` back — override this list explicitly if a
     * migrating deployment needs it advertised.
     */
    codeChallengeMethodsSupported: ['S256'],
  },
};

@Module({})
export class McpAuthModule {
  /**
   * To avoid import circular dependency issues, we use a marker property.
   */
  readonly __isMcpAuthModule = true;

  static forRoot(options: AuthUserModuleOptions): DynamicModule {
    // Create a unique instance ID for this auth module
    const authModuleId = `mcp-auth-module-${authInstanceIdCounter++}`;

    // Merge user options with defaults and validate
    const resolvedOptions = this.mergeAndValidateOptions(
      DEFAULT_OPTIONS,
      options,
    );

    resolvedOptions.endpoints = prepareEndpoints(
      resolvedOptions.apiPrefix,
      DEFAULT_OPTIONS.endpoints,
      options.endpoints || {},
    );

    // Use instance-scoped token for OAuth options
    const oauthModuleOptionsToken = `OAUTH_MODULE_OPTIONS_${authModuleId}`;
    const oauthModuleOptions = {
      provide: oauthModuleOptionsToken,
      useValue: resolvedOptions,
    };

    // Determine imports based on configuration
    const imports = [
      ConfigModule,
      // Lets ScopePolicyService read @ToolScopes() off the app's @McpControllers.
      DiscoveryModule,
      PassportModule.register({
        defaultStrategy: 'jwt',
        session: false,
      }),
      JwtModule.register({
        secret: resolvedOptions.jwtSecret,
        signOptions: {
          issuer: resolvedOptions.jwtIssuer,
          audience: resolvedOptions.jwtAudience,
        },
      }),
    ];

    // Add TypeORM configuration if using TypeORM store
    const storeConfig = resolvedOptions.storeConfiguration;
    const isTypeOrmStore = storeConfig?.type === 'typeorm';
    if (isTypeOrmStore) {
      const typeormOptions = storeConfig.options;
      try {
        // Require TypeORM-related modules only when needed
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { TypeOrmModule } = require('@nestjs/typeorm');
        const {
          OAuthClientEntity,
          AuthorizationCodeEntity,
          OAuthSessionEntity,
          OAuthUserProfileEntity,
          // eslint-disable-next-line @typescript-eslint/no-require-imports
        } = require('./stores/typeorm/entities');

        imports.push(
          TypeOrmModule.forRoot({
            ...typeormOptions,
            // Use a unique connection name for the OAuth store to avoid clashes
            name: OAUTH_TYPEORM_CONNECTION_NAME,
            entities: [
              OAuthClientEntity,
              AuthorizationCodeEntity,
              OAuthSessionEntity,
              OAuthUserProfileEntity,
            ],
          }),
          TypeOrmModule.forFeature(
            [
              OAuthClientEntity,
              AuthorizationCodeEntity,
              OAuthSessionEntity,
              OAuthUserProfileEntity,
            ],
            OAUTH_TYPEORM_CONNECTION_NAME,
          ),
        );
      } catch (err) {
        throw new Error(
          "To use the TypeORM store, please install '@nestjs/typeorm' and 'typeorm'.",
        );
      }
    }

    // Create store provider based on configuration with instance-scoped token
    const oauthStoreToken = `IOAuthStore_${authModuleId}`;
    const oauthStoreProvider = this.createStoreProvider(
      resolvedOptions.storeConfiguration,
      oauthStoreToken,
    );

    // Create alias for compatibility with injection
    const oauthStoreAliasProvider = {
      provide: MemoryStore,
      useExisting: oauthStoreToken,
    };

    const providers: any[] = [
      {
        provide: 'OAUTH_MODULE_ID',
        useValue: authModuleId,
      },
      oauthModuleOptions,
      oauthStoreProvider,
      oauthStoreAliasProvider,
      // Provide backward-compatible tokens as aliases
      {
        provide: 'OAUTH_MODULE_OPTIONS',
        useExisting: oauthModuleOptionsToken,
      },
      {
        provide: 'IOAuthStore',
        useExisting: oauthStoreToken,
      },
      // Provide services using their class tokens
      OAuthStrategyService,
      ClientIdMetadataService,
      ClientService,
      ConsentService,
      JwtTokenService,
      ScopePolicyService,
      McpAuthJwtGuard,
      // Refuses to finish booting if the host forgot `app.use(cookieParser())`,
      // so the omission cannot reach production as a callback that 400s after
      // the user has already logged in at the IdP.
      CookieParserCheckService,
    ];

    // No additional providers needed for TypeORM store - provider is created dynamically

    // Create controller with apiPrefix, passing the instance-scoped tokens
    const OAuthControllerClass = createMcpOAuthController(
      resolvedOptions.endpoints,
      {
        disableWellKnownAuthorizationServerMetadata:
          resolvedOptions.disableEndpoints
            .wellKnownAuthorizationServerMetadata ?? false,
        disableWellKnownProtectedResourceMetadata:
          resolvedOptions.disableEndpoints.wellKnownProtectedResourceMetadata ??
          false,
        disableRegister: resolvedOptions.disableEndpoints.register ?? false,
        // Route registration is a build-time decision, so the flag has to reach
        // the controller factory rather than being read off the options at
        // request time: with consent off there is no POST /consent route at all.
        consentEnabled: resolvedOptions.consent.enabled,
      },
      authModuleId,
    );

    return {
      module: McpAuthModule,
      imports,
      controllers: [OAuthControllerClass],
      providers,
      exports: [
        'OAUTH_MODULE_ID',
        'OAUTH_MODULE_OPTIONS',
        'IOAuthStore',
        JwtTokenService,
        ClientService,
        ClientIdMetadataService,
        ConsentService,
        OAuthStrategyService,
        ScopePolicyService,
        McpAuthJwtGuard,
        MemoryStore,
      ],
    };
  }

  private static mergeAndValidateOptions(
    defaults: OAuthModuleDefaults,
    options: AuthUserModuleOptions,
  ): OAuthModuleOptions {
    // Validate required options first
    this.validateRequiredOptions(options);

    // Refuse the one combination that cannot be made conformant. Silently
    // ignoring an explicit `consent: { enabled: false }` would leave the
    // deployment advertising `client_id_metadata_document_supported` while never
    // showing the redirect-URI hostname the draft makes a MUST — a security
    // property quietly missing is worse than a boot failure that names it.
    if (
      options.clientIdMetadataDocuments?.enabled === true &&
      options.consent?.enabled === false
    ) {
      throw new Error(
        'OAuthModuleOptions: clientIdMetadataDocuments.enabled requires the ' +
          'consent screen, but consent.enabled was explicitly set to false. A ' +
          'Client ID Metadata Document client is identified only by a URL it ' +
          'controls, so the specification requires the authorization server to ' +
          'clearly display the redirect URI hostname during authorization — ' +
          'which needs a consent screen. Either remove consent.enabled: false ' +
          '(it defaults to true whenever CIMD is on) or turn CIMD off.',
      );
    }

    // Merge with defaults
    const resolvedOptions: OAuthModuleOptions = {
      ...defaults,
      ...options,
      // Ensure jwtIssuer defaults to serverUrl if not provided
      jwtIssuer:
        options.jwtIssuer || options.serverUrl || DEFAULT_OPTIONS.jwtIssuer,
      // Ensure the advertised resource defaults to `${serverUrl}/mcp` if not
      // provided, instead of the hard-coded localhost:3000 default. Otherwise a
      // server on a non-default serverUrl would advertise a resource pointing at
      // port 3000 in its protected-resource metadata and minted tokens.
      resource:
        options.resource ||
        (options.serverUrl
          ? normalizeEndpoint(`${options.serverUrl}/mcp`)
          : DEFAULT_OPTIONS.resource),
      cookieSecure:
        options.cookieSecure || process.env.NODE_ENV === 'production',
      // Merge protectedResourceMetadata with defaults
      protectedResourceMetadata: {
        ...defaults.protectedResourceMetadata,
        ...options.protectedResourceMetadata,
      },
      // Merge authorizationServerMetadata with defaults
      authorizationServerMetadata: {
        ...defaults.authorizationServerMetadata,
        ...options.authorizationServerMetadata,
      },
      // Merge disableEndpoints with defaults
      disableEndpoints: {
        ...defaults.disableEndpoints,
        ...(options.disableEndpoints || {}),
      },
      consent: {
        ...defaults.consent,
        ...(options.consent || {}),
        /**
         * Consent is a hard prerequisite for conformant CIMD support: the draft's
         * security considerations say an authorization server "**MUST** clearly
         * display the redirect URI hostname during authorization", and there is
         * nowhere to display it without a screen. So enabling CIMD turns consent
         * on unless the operator said something explicit — and if they explicitly
         * said `false`, `validateResolvedOptions` refuses to boot rather than
         * quietly overriding a security-relevant opt-out.
         */
        enabled:
          options.consent?.enabled ??
          options.clientIdMetadataDocuments?.enabled ??
          defaults.consent.enabled,
      },
      clientIdMetadataDocuments: {
        ...defaults.clientIdMetadataDocuments,
        ...(options.clientIdMetadataDocuments || {}),
      },
    };

    if (!resolvedOptions.enableRefreshTokens) {
      resolvedOptions.authorizationServerMetadata.grantTypesSupported =
        resolvedOptions.authorizationServerMetadata.grantTypesSupported.filter(
          (g) => g !== 'refresh_token',
        );
      // Both lists, not just the protected-resource one. `offline_access` is
      // what a client asks for to obtain a refresh token; leaving it in the
      // authorization-server list advertised (and, since Tier 2's scope
      // narrowing, actually granted) a scope this server will never honour.
      resolvedOptions.authorizationServerMetadata.scopesSupported =
        resolvedOptions.authorizationServerMetadata.scopesSupported.filter(
          (s) => s !== 'offline_access',
        );
      resolvedOptions.protectedResourceMetadata.scopesSupported =
        resolvedOptions.protectedResourceMetadata.scopesSupported.filter(
          (s) => s !== 'offline_access',
        );
    }

    // Final validation of resolved options
    this.validateResolvedOptions(resolvedOptions);

    return resolvedOptions;
  }

  private static validateRequiredOptions(options: AuthUserModuleOptions): void {
    const requiredFields: (keyof AuthUserModuleOptions)[] = [
      'provider',
      'clientId',
      'clientSecret',
      'jwtSecret',
    ];

    for (const field of requiredFields) {
      if (!options[field]) {
        throw new Error(
          `OAuthModuleOptions: ${String(field)} is required and must be provided by the user`,
        );
      }
    }
  }

  private static validateResolvedOptions(options: OAuthModuleOptions): void {
    // Validate JWT secret is strong enough
    if (options.jwtSecret.length < 32) {
      throw new Error(
        'OAuthModuleOptions: jwtSecret must be at least 32 characters long',
      );
    }

    // Validate URLs are proper format
    try {
      new URL(options.serverUrl);
      new URL(options.jwtIssuer);
    } catch {
      throw new Error(
        'OAuthModuleOptions: serverUrl and jwtIssuer must be valid URLs',
      );
    }

    // One canonical issuer, or none at all. The authorization-server metadata
    // document is served from `serverUrl` and advertises `jwtIssuer` as its
    // `issuer`; a client that fetched it MUST NOT use a document whose `issuer`
    // differs from the identifier it built the well-known URL from. A server
    // configured with divergent values is therefore unusable by any conforming
    // client, so this fails at bootstrap rather than at handshake time.
    if (
      canonicalIssuer(options.jwtIssuer) !== canonicalIssuer(options.serverUrl)
    ) {
      throw new Error(
        `OAuthModuleOptions: jwtIssuer ('${options.jwtIssuer}') must be the same ` +
          `identifier as serverUrl ('${options.serverUrl}'). Clients MUST NOT use ` +
          `authorization server metadata whose 'issuer' differs from the URL it was ` +
          `fetched from. Either omit jwtIssuer (it defaults to serverUrl), or set ` +
          `serverUrl to the issuer you want to advertise.`,
      );
    }

    // One-time bootstrap warning, not a per-request one: an operator can act on
    // this by flipping the option back, and PKCE being off is a standing
    // property of the deployment rather than of any single request.
    if (!options.requirePkce) {
      new Logger(McpAuthModule.name).warn(
        'requirePkce: false is set — /authorize accepts a request with no ' +
          'code_challenge, and such an authorization code can then be redeemed ' +
          'with no proof of possession, so an intercepted code is enough to get ' +
          'a token. OAuth 2.1 requires PKCE with S256; intended only as a ' +
          'migration window for a non-conforming client.',
      );
    }

    // Same reasoning as the PKCE warning: a standing property of the deployment,
    // actionable by flipping one option, so it belongs at bootstrap and not on
    // every resolved document.
    if (options.clientIdMetadataDocuments.allowInsecureClientIdScheme) {
      new Logger(McpAuthModule.name).warn(
        'clientIdMetadataDocuments.allowInsecureClientIdScheme: true is set — ' +
          'http:// client_id URLs are accepted and the SSRF guard no longer ' +
          'refuses loopback/private destinations, so any caller can make this ' +
          'server fetch an internal URL. This is a development-only switch ' +
          '(it exists so a metadata document can be served from localhost ' +
          'without TLS); never enable it in production.',
      );
    }

    // Validate provider configuration
    if (!options.provider.name || !options.provider.strategy) {
      throw new Error(
        'OAuthModuleOptions: provider must have name and strategy',
      );
    }
  }

  private static createStoreProvider(
    storeConfiguration: OAuthModuleOptions['storeConfiguration'],
    provideToken: string,
  ) {
    if (!storeConfiguration || storeConfiguration.type === 'memory') {
      // Default memory store
      return {
        provide: provideToken,
        useValue: new MemoryStore(),
      };
    }

    if (storeConfiguration.type === 'typeorm') {
      // TypeORM store
      const {
        TypeOrmStore,
        // eslint-disable-next-line @typescript-eslint/no-require-imports
      } = require('./stores/typeorm/typeorm-store.service');
      return {
        provide: provideToken,
        useClass: TypeOrmStore,
      };
    }

    if (storeConfiguration.type === 'custom') {
      // Custom store
      return {
        provide: provideToken,
        useValue: storeConfiguration.store,
      };
    }

    throw new Error(
      `Unknown store configuration type: ${(storeConfiguration as any).type}`,
    );
  }
}

/**
 * Compare issuer identifiers the way a client would: a trailing slash is not a
 * difference, anything else is.
 *
 * Scans backwards rather than using `/\/+$/` — that regex restarts its run at
 * every slash before failing the anchor, which is quadratic on a long run of
 * slashes that does not end the string.
 */
function canonicalIssuer(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end--;
  return url.slice(0, end);
}

function prepareEndpoints(
  apiPrefix: string,
  defaultEndpoints: OAuthEndpointConfiguration,
  configuredEndpoints: OAuthEndpointConfiguration,
) {
  const updatedDefaultEndpoints = {
    wellKnownAuthorizationServerMetadata:
      defaultEndpoints.wellKnownAuthorizationServerMetadata,
    wellKnownProtectedResourceMetadata:
      defaultEndpoints.wellKnownProtectedResourceMetadata,
    callback: normalizeEndpoint(`/${apiPrefix}/${defaultEndpoints.callback}`),
    consent: normalizeEndpoint(`/${apiPrefix}/${defaultEndpoints.consent}`),
    token: normalizeEndpoint(`/${apiPrefix}/${defaultEndpoints.token}`),
    authorize: normalizeEndpoint(`/${apiPrefix}/${defaultEndpoints.authorize}`),
    register: normalizeEndpoint(`/${apiPrefix}/${defaultEndpoints.register}`),
  } as OAuthEndpointConfiguration;

  return {
    ...updatedDefaultEndpoints,
    ...configuredEndpoints,
  };
}
