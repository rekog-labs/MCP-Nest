import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { IOAuthStore } from '../stores/oauth-store.interface';

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
  wellKnown?: string; // Default: '/.well-known/oauth-authorization-server'
  register?: string; // Default: '/register'
  authorize?: string; // Default: '/authorize'
  auth?: string; // Default: '/auth'
  callback?: string; // Default: '/auth/callback'
  token?: string; // Default: '/token'
  validate?: string; // Default: '/validate'
  revoke?: string; // Default: '/revoke'
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

  // JWT Configuration
  jwtIssuer?: string;
  jwtAudience?: string;
  jwtAccessTokenExpiresIn?: string;
  jwtRefreshTokenExpiresIn?: string;

  // Cookie Configuration
  cookieSecure?: boolean;
  cookieMaxAge?: number;

  // OAuth Session Configuration
  oauthSessionExpiresIn?: number; // in milliseconds
  authCodeExpiresIn?: number; // in milliseconds

  // Environment Configuration
  nodeEnv?: string; // 'development' | 'production'

  // Storage Configuration - single property for all storage options
  storeConfiguration?: StoreConfiguration;
  apiPrefix?: string;

  // Endpoint Configuration
  endpoints?: OAuthEndpointConfiguration;
}

export interface OAuthModuleDefaults {
  serverUrl: string;
  jwtIssuer: string;
  jwtAudience: string;
  jwtAccessTokenExpiresIn: string;
  jwtRefreshTokenExpiresIn: string;
  cookieMaxAge: number;
  oauthSessionExpiresIn: number;
  authCodeExpiresIn: number;
  nodeEnv: string;
  apiPrefix: string;
  endpoints: OAuthEndpointConfiguration;
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
  resource?: string;
  expiresAt: number;
}
