import { DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { McpAuthJwtGuard } from './guards/jwt-auth.guard';
import { createMcpOAuthController } from './mcp-oauth.controller';
import {
  OAuthUserModuleOptions as AuthUserModuleOptions,
  OAuthEndpointConfiguration,
  OAuthModuleDefaults,
  OAuthModuleOptions,
} from './providers/oauth-provider.interface';
import { ClientService } from './services/client.service';
import { JwtTokenService } from './services/jwt-token.service';
import { OAuthStrategyService } from './services/oauth-strategy.service';
import { MemoryStore } from './stores/memory-store.service';
import {
  AuthorizationCodeEntity,
  OAuthClientEntity,
  OAuthSessionEntity,
} from './stores/typeorm/entities';
import { TypeOrmStore } from './stores/typeorm/typeorm-store.service';
import { normalizeEndpoint } from '../mcp/utils/normalize-endpoint';

// Default configuration values
export const DEFAULT_OPTIONS: OAuthModuleDefaults = {
  serverUrl: 'https://localhost:3000',
  resource: 'https://localhost:3000/mcp',
  jwtIssuer: 'https://localhost:3000',
  jwtAudience: 'mcp-client',
  jwtAccessTokenExpiresIn: '60s',
  jwtRefreshTokenExpiresIn: '30d',
  cookieMaxAge: 24 * 60 * 60 * 1000, // 24 hours
  oauthSessionExpiresIn: 10 * 60 * 1000, // 10 minutes
  authCodeExpiresIn: 10 * 60 * 1000, // 10 minutes
  nodeEnv: 'development',
  apiPrefix: '',
  endpoints: {
    wellKnownAuthorizationServerMetadata:
      '/.well-known/oauth-authorization-server',
    wellKnownProtectedResourceMetadata: '/.well-known/oauth-protected-resource',
    register: '/register',
    authorize: '/authorize',
    callback: '/callback',
    token: '/token',
    revoke: '/revoke',
  },
  protectedResourceMetadata: {
    scopesSupported: ['offline_access'],
    bearerMethodsSupported: ['header'],
    mcpVersionsSupported: ['2025-06-18'],
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
    codeChallengeMethodsSupported: ['plain', 'S256'],
  },
};

@Global()
@Module({})
export class McpAuthModule {
  static forRoot(options: AuthUserModuleOptions): DynamicModule {
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
    const oauthModuleOptions = {
      provide: 'OAUTH_MODULE_OPTIONS',
      useValue: resolvedOptions,
    };

    // Determine imports based on configuration
    const imports = [
      ConfigModule,
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
    if (storeConfig && storeConfig.type === 'typeorm') {
      const typeormOptions = storeConfig.options;
      imports.push(
        TypeOrmModule.forRoot({
          ...typeormOptions,
          entities: [
            ...((typeormOptions.entities || []) as any[]),
            OAuthClientEntity,
            AuthorizationCodeEntity,
            OAuthSessionEntity,
          ],
        }),
        TypeOrmModule.forFeature([
          OAuthClientEntity,
          AuthorizationCodeEntity,
          OAuthSessionEntity,
        ]),
      );
    }

    // Create store provider based on configuration
    const oauthStoreProvider = this.createStoreProvider(
      resolvedOptions.storeConfiguration,
    );

    // Create alias for compatibility with injection
    const oauthStoreAliasProvider = {
      provide: MemoryStore,
      useExisting: 'IOAuthStore',
    };

    const providers: any[] = [
      oauthModuleOptions,
      oauthStoreProvider,
      oauthStoreAliasProvider,
      OAuthStrategyService,
      ClientService,
      JwtTokenService,
      McpAuthJwtGuard,
    ];

    // Add TypeOrmStore to providers if using TypeORM
    if (isTypeOrmStore) {
      providers.push(TypeOrmStore);
    }

    // Create controller with apiPrefix
    const OAuthControllerClass = createMcpOAuthController(
      resolvedOptions.endpoints,
    );

    return {
      module: McpAuthModule,
      imports,
      controllers: [OAuthControllerClass],
      providers,
      exports: [
        JwtTokenService,
        'IOAuthStore',
        MemoryStore,
        McpAuthJwtGuard,
        OAuthStrategyService,
      ],
    };
  }

  private static mergeAndValidateOptions(
    defaults: OAuthModuleDefaults,
    options: AuthUserModuleOptions,
  ): OAuthModuleOptions {
    // Validate required options first
    this.validateRequiredOptions(options);

    // Merge with defaults
    const resolvedOptions: OAuthModuleOptions = {
      ...defaults,
      ...options,
      // Ensure jwtIssuer defaults to serverUrl if not provided
      jwtIssuer:
        options.jwtIssuer || options.serverUrl || DEFAULT_OPTIONS.jwtIssuer,
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
    };

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

    // Validate provider configuration
    if (!options.provider.name || !options.provider.strategy) {
      throw new Error(
        'OAuthModuleOptions: provider must have name and strategy',
      );
    }
  }

  private static createStoreProvider(
    storeConfiguration: OAuthModuleOptions['storeConfiguration'],
  ) {
    if (!storeConfiguration || storeConfiguration.type === 'memory') {
      // Default memory store
      return {
        provide: 'IOAuthStore',
        useValue: new MemoryStore(),
      };
    }

    if (storeConfiguration.type === 'typeorm') {
      // TypeORM store
      return {
        provide: 'IOAuthStore',
        useClass: TypeOrmStore,
      };
    }

    if (storeConfiguration.type === 'custom') {
      // Custom store
      return {
        provide: 'IOAuthStore',
        useValue: storeConfiguration.store,
      };
    }

    throw new Error(
      `Unknown store configuration type: ${(storeConfiguration as any).type}`,
    );
  }
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
    token: normalizeEndpoint(`/${apiPrefix}/${defaultEndpoints.token}`),
    revoke: normalizeEndpoint(`/${apiPrefix}/${defaultEndpoints.revoke}`),
    authorize: normalizeEndpoint(`/${apiPrefix}/${defaultEndpoints.authorize}`),
    register: normalizeEndpoint(`/${apiPrefix}/${defaultEndpoints.register}`),
  } as OAuthEndpointConfiguration;

  return {
    ...updatedDefaultEndpoints,
    ...configuredEndpoints,
  };
}
