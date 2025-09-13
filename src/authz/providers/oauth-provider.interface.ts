import { IOAuthStore } from '../stores/oauth-store.interface';

// Define a minimal placeholder for TypeORM options so the type remains
// available without requiring the optional `@nestjs/typeorm` package.
// Consumers who use the TypeORM store should install the package to get
// the full type definitions.
type TypeOrmModuleOptions = Record<string, unknown>;

export interface OAuthProviderConfig {
  name: string;
  displayName?: string;
  strategy: any; // Passport Strategy constructor
  strategyOptions: (options: {
    serverUrl: string;
    clientId: string;
    clientSecret: string;
    callbackPath?: string; // Optional custom callback path
  }) => any;
  scope?: string[];
  profileMapper: (profile: any) => OAuthUserProfile;
}

export interface OAuthUserProfile {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  raw?: any; // Original profile data
}

// Store configuration union type
export type StoreConfiguration =
  | { type: 'typeorm'; options: TypeOrmModuleOptions }
  | { type: 'custom'; store: IOAuthStore }
  | { type: 'memory' }
  | undefined; // Default to memory store

export interface OAuthEndpointConfiguration {
  wellKnownAuthorizationServerMetadata?: string; // Default: '/.well-known/oauth-authorization-server'
  wellKnownProtectedResourceMetadata?: string | string[]; // Default: '/.well-known/oauth-protected-resource'
  register?: string; // Default: '/register'
  authorize?: string; // Default: '/authorize'
  callback?: string; // Default: '/callback'
  token?: string; // Default: '/token'
  revoke?: string; // Default: '/revoke'
}

export interface OAuthEndpointDisableOptions {
  wellKnownAuthorizationServerMetadata?: boolean;
  wellKnownProtectedResourceMetadata?: boolean;
}

export interface OAuthUserModuleOptions {
  provider: OAuthProviderConfig;

  // Required OAuth Provider Credentials
  clientId: string;
  clientSecret: string;

  // Required JWT Configuration
  jwtSecret: string;

  // Server Configuration
  serverUrl?: string;
  resource?: string; // should be the endpoint clients connect to, e.g.: 'https://localhost:3000/mcp'
  // JWT Configuration
  jwtIssuer?: string;
  jwtAudience?: string;
  jwtAccessTokenExpiresIn?: string;
  jwtRefreshTokenExpiresIn?: string;
  enableRefreshTokens?: boolean;

  // Cookie Configuration
  cookieSecure?: boolean;
  cookieMaxAge?: number;

  // OAuth Session Configuration
  oauthSessionExpiresIn?: number; // in milliseconds
  authCodeExpiresIn?: number; // in milliseconds

  // Protected Resource Metadata Configuration
  protectedResourceMetadata?: {
    scopesSupported?: string[];
    bearerMethodsSupported?: string[];
    mcpVersionsSupported?: string[];
  };

  // Authorization Server Metadata Configuration
  authorizationServerMetadata?: {
    responseTypesSupported?: string[];
    responseModesSupported?: string[];
    grantTypesSupported?: string[];
    tokenEndpointAuthMethodsSupported?: string[];
    scopesSupported?: string[];
    codeChallengeMethodsSupported?: string[];
  };

  // Storage Configuration - single property for all storage options
  storeConfiguration?: StoreConfiguration;
  apiPrefix?: string;

  // Endpoint Configuration
  endpoints?: OAuthEndpointConfiguration;
  disableEndpoints?: OAuthEndpointDisableOptions;
}

export interface OAuthModuleDefaults {
  serverUrl: string;
  resource: string; // Default resource URL
  jwtIssuer: string;
  jwtAudience: string;
  jwtAccessTokenExpiresIn: string;
  jwtRefreshTokenExpiresIn: string;
  enableRefreshTokens: boolean;
  cookieMaxAge: number;
  oauthSessionExpiresIn: number;
  authCodeExpiresIn: number;
  nodeEnv: string;
  apiPrefix: string;
  endpoints: OAuthEndpointConfiguration;
  disableEndpoints: OAuthEndpointDisableOptions;
  protectedResourceMetadata: {
    scopesSupported: string[];
    bearerMethodsSupported: string[];
    mcpVersionsSupported: string[];
  };
  authorizationServerMetadata: {
    responseTypesSupported: string[];
    responseModesSupported: string[];
    grantTypesSupported: string[];
    tokenEndpointAuthMethodsSupported: string[];
    scopesSupported: string[];
    codeChallengeMethodsSupported: string[];
  };
}

// Resolved options after merging with defaults
export type OAuthModuleOptions = Required<
  Pick<
    OAuthUserModuleOptions,
    'provider' | 'clientId' | 'clientSecret' | 'jwtSecret'
  >
> &
  Required<OAuthModuleDefaults> & {
    // Optional fields that may remain undefined
    cookieSecure: boolean;
    storeConfiguration?: StoreConfiguration;
  };

export interface OAuthSession {
  sessionId: string;
  state: string;
  clientId?: string;
  redirectUri?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  oauthState?: string;
  scope?: string;
  resource?: string;
  expiresAt: number;
}
