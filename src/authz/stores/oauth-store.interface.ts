import { OAuthSession } from '../providers/oauth-provider.interface';

export interface OAuthClient {
  client_id: string;
  client_name: string;
  client_description?: string;
  logo_uri?: string;
  client_uri?: string;
  developer_name?: string;
  developer_email?: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  created_at: Date;
  updated_at: Date;
}

export interface AuthorizationCode {
  code: string;
  user_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: number;
  used_at?: Date;
  github_access_token: string;
}

export interface ClientRegistrationDto {
  client_name: string;
  client_description?: string;
  logo_uri?: string;
  client_uri?: string;
  developer_name?: string;
  developer_email?: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}

/**
 * Interface for OAuth store implementations.
 *
 * Implement this interface to create custom storage solutions (e.g., Redis, Database, etc.).
 * The default implementation is an in-memory store suitable for development.
 *
 * @example
 * ```typescript
 * class RedisOAuthStore implements IOAuthStore {
 *   constructor(private redisClient: RedisClient) {}
 *
 *   async storeClient(client: OAuthClient): Promise<void> {
 *     await this.redisClient.set(`client:${client.client_id}`, JSON.stringify(client));
 *   }
 *
 *   async getClient(client_id: string): Promise<OAuthClient | undefined> {
 *     const data = await this.redisClient.get(`client:${client_id}`);
 *     return data ? JSON.parse(data) : undefined;
 *   }
 *
 *   async findClient(client_name: string): Promise<OAuthClient | undefined> {
 *     const data = await this.redisClient.get(`client_name:${client_name}`);
 *     return data ? JSON.parse(data) : undefined;
 *   }
 *
 *   generateClientId(client: OAuthClient): string {
 *     // Custom client ID generation logic
 *     const normalizedName = client.client_name.toLowerCase().replace(/[^a-z0-9]/g, '');
 *     const timestamp = Date.now().toString(36);
 *     return `${normalizedName}_${timestamp}`;
 *   }
 *
 *   // ... implement other methods
 * }
 *
 * // Usage in module:
 * McpOAuthModule.forRoot({
 *   provider: GoogleOAuthProvider,
 *   clientId: process.env.GOOGLE_CLIENT_ID!,
 *   clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
 *   jwtSecret: process.env.JWT_SECRET!,
 *   memoryStore: new RedisOAuthStore(redisClient), // Custom implementation
 * })
 * ```
 */
export interface IOAuthStore {
  // Client management
  storeClient(client: OAuthClient): Promise<OAuthClient>;
  getClient(client_id: string): Promise<OAuthClient | undefined>;
  findClient(client_name: string): Promise<OAuthClient | undefined>;
  generateClientId(client: OAuthClient): string;

  // Authorization code management
  storeAuthCode(code: AuthorizationCode): Promise<void>;
  getAuthCode(code: string): Promise<AuthorizationCode | undefined>;
  removeAuthCode(code: string): Promise<void>;

  // OAuth session management
  storeOAuthSession(sessionId: string, session: OAuthSession): Promise<void>;
  getOAuthSession(sessionId: string): Promise<OAuthSession | undefined>;
  removeOAuthSession(sessionId: string): Promise<void>;
}
