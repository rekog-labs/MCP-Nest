import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { McpModule, McpTransportType } from '../../src/mcp';
import {
  McpAuthModule,
  GitHubOAuthProvider,
  EncryptionService,
  McpAuthJwtGuard,
} from '../../src/authz';

/**
 * Example showing how to configure OAuth with AES-256 encryption
 * for sensitive data stored in the database.
 */
@Module({
  imports: [
    ConfigModule.forRoot(),

    // OAuth module with encryption enabled
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      serverUrl: process.env.SERVER_URL || 'http://localhost:3000',

      // Configure TypeORM store with encryption
      storeConfiguration: {
        type: 'typeorm',
        options: {
          type: 'postgres', // or 'mysql', 'sqlite', etc.
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432'),
          username: process.env.DB_USERNAME || 'oauth_user',
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME || 'oauth_db',
          synchronize: process.env.NODE_ENV === 'development', // Only for dev
          logging: process.env.NODE_ENV === 'development',
        },

        // Enable AES-256 encryption for sensitive data
        encryption: {
          // Use raw encryption key (recommended for production)
          encryptionKey: process.env.ENCRYPTION_KEY!, // Must be 64 hex characters

          // Or use password-based key derivation (easier for development)
          // encryptionKey: process.env.ENCRYPTION_PASSWORD!,
          // useKeyDerivation: true,

          algorithm: 'aes-256-gcm', // Recommended (provides integrity + confidentiality)
          // algorithm: 'aes-256-cbc', // Alternative (confidentiality only)
        },
      },
    }),

    // MCP module with authentication
    McpModule.forRoot({
      name: 'secure-mcp-server',
      version: '1.0.0',
      transport: [McpTransportType.SSE, McpTransportType.STREAMABLE_HTTP],
      guards: [McpAuthJwtGuard], // Protect all MCP endpoints
    }),
  ],
})
export class SecureOAuthAppModule {}

/**
 * Environment variables required:
 *
 * # OAuth Provider (GitHub example)
 * GITHUB_CLIENT_ID=your_github_client_id
 * GITHUB_CLIENT_SECRET=your_github_client_secret
 *
 * # Server Configuration
 * SERVER_URL=https://your-domain.com
 * JWT_SECRET=your-strong-jwt-secret-at-least-32-chars
 *
 * # Database Configuration
 * DB_HOST=localhost
 * DB_PORT=5432
 * DB_USERNAME=oauth_user
 * DB_PASSWORD=your-db-password
 * DB_NAME=oauth_db
 *
 * # Encryption Configuration (choose one approach)
 *
 * # Option 1: Raw encryption key (recommended for production)
 * ENCRYPTION_KEY=your-64-character-hex-key-here
 *
 * # Option 2: Password-based key derivation (easier for development)
 * # ENCRYPTION_PASSWORD=your-strong-password-here
 *
 * # Generate encryption key with:
 * # node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

/**
 * What gets encrypted:
 *
 * OAuth Clients:
 * - client_secret (OAuth client secret)
 * - developer_email (developer's email)
 *
 * Authorization Codes:
 * - user_id (user identifier)
 * - code_challenge (PKCE challenge)
 * - github_access_token (provider access token)
 * - user_profile_id (user profile reference)
 *
 * OAuth Sessions:
 * - state (session state)
 * - codeChallenge (PKCE challenge)
 * - oauthState (OAuth state)
 *
 * User Profiles:
 * - username (username)
 * - email (email address)
 * - displayName (display name)
 * - raw (raw provider profile JSON)
 */

// Example of manually using the encryption service
export function demonstrateEncryption() {
  // Generate a new encryption key
  const encryptionKey = EncryptionService.generateKey();
  console.log('Generated encryption key:', encryptionKey);

  // Create encryption service
  const encryptionService = new EncryptionService({
    encryptionKey,
    algorithm: 'aes-256-gcm',
  });

  // Encrypt sensitive data
  const sensitiveData = 'user-secret-token-12345';
  const encrypted = encryptionService.encrypt(sensitiveData);
  console.log('Encrypted:', encrypted);

  // Decrypt data
  const decrypted = encryptionService.decrypt(encrypted!);
  console.log('Decrypted:', decrypted);
  console.log('Match:', decrypted === sensitiveData);
}

// Example Docker Compose setup for development
export const dockerCompose = `
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: oauth_db
      POSTGRES_USER: oauth_user
      POSTGRES_PASSWORD: your-db-password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  app:
    build: .
    environment:
      - NODE_ENV=development
      - DB_HOST=postgres
      - DB_PORT=5432
      - DB_USERNAME=oauth_user
      - DB_PASSWORD=your-db-password
      - DB_NAME=oauth_db
      - GITHUB_CLIENT_ID=your_github_client_id
      - GITHUB_CLIENT_SECRET=your_github_client_secret
      - JWT_SECRET=your-strong-jwt-secret-at-least-32-chars
      - ENCRYPTION_KEY=your-64-character-hex-key-here
      - SERVER_URL=http://localhost:3000
    ports:
      - "3000:3000"
    depends_on:
      - postgres

volumes:
  postgres_data:
`;
