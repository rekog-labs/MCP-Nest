# OAuth Store Encryption

This document explains how to use AES-256 encryption for sensitive data in the OAuth TypeORM store.

## Overview

The OAuth store now supports optional AES-256 encryption for sensitive data stored in the database. When encryption is enabled, the following fields are automatically encrypted:

### Encrypted Fields by Entity

#### OAuth Clients (`oauth_clients`)

- `client_secret` - OAuth client secret
- `developer_email` - Developer's email address

#### Authorization Codes (`oauth_authorization_codes`)

- `user_id` - User identifier
- `code_challenge` - PKCE code challenge
- `github_access_token` - Provider access token
- `user_profile_id` - User profile reference (if present)

#### OAuth Sessions (`oauth_sessions`)

- `state` - Session state
- `codeChallenge` - PKCE code challenge
- `oauthState` - OAuth provider state

#### User Profiles (`oauth_user_profiles`)

- `username` - Username
- `email` - Email address
- `displayName` - Display name
- `raw` - Raw provider profile data (JSON)

## Configuration

### Basic Usage

```typescript
import { McpAuthModule } from '@rekog/mcp-nest';
import { GitHubOAuthProvider } from '@rekog/mcp-nest/authz';
import { EncryptionService } from '@rekog/mcp-nest/authz';

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      serverUrl: 'http://localhost:3000',
      storeConfiguration: {
        type: 'typeorm',
        options: {
          type: 'postgres',
          host: 'localhost',
          port: 5432,
          username: 'oauth_user',
          database: 'oauth_db',
          password: process.env.DB_PASSWORD,
          synchronize: true, // Only for development
        },
        // Enable encryption with custom key
        encryption: {
          encryptionKey: process.env.ENCRYPTION_KEY!, // 64 hex characters
          algorithm: 'aes-256-gcm', // or 'aes-256-cbc'
        },
      },
    }),
  ],
})
export class AppModule {}
```

### Encryption Options

#### Using Raw Encryption Key (Recommended)

```typescript
// Generate a secure key (do this once, store securely)
const encryptionKey = EncryptionService.generateKey(); // Returns 64 hex characters
console.log('Store this key securely:', encryptionKey);

// In your module configuration
encryption: {
  encryptionKey: process.env.ENCRYPTION_KEY, // 64 hex characters (32 bytes)
  algorithm: 'aes-256-gcm', // Provides both confidentiality and integrity
}
```

#### Using Password-Based Key Derivation

```typescript
encryption: {
  encryptionKey: process.env.ENCRYPTION_PASSWORD, // Any length password
  algorithm: 'aes-256-gcm',
  useKeyDerivation: true, // Derives key from password using scrypt
}
```

### Algorithm Options

#### AES-256-GCM (Recommended)

- Provides both confidentiality and integrity
- Authenticated encryption (prevents tampering)
- Slightly larger storage overhead

```typescript
encryption: {
  encryptionKey: process.env.ENCRYPTION_KEY,
  algorithm: 'aes-256-gcm',
}
```

#### AES-256-CBC (Traditional)

- Block cipher mode
- Confidentiality only (no integrity protection)
- Smaller storage overhead

```typescript
encryption: {
  encryptionKey: process.env.ENCRYPTION_KEY,
  algorithm: 'aes-256-cbc',
}
```

## Security Best Practices

### Key Management

1. **Generate Strong Keys**:

   ```bash
   # Generate a random 256-bit key
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Store Keys Securely**:

   - Use environment variables
   - Consider using secret management services (AWS Secrets Manager, Azure Key Vault, etc.)
   - Never commit keys to version control

3. **Key Rotation**:
   - Plan for key rotation in production
   - Consider implementing versioned encryption for gradual migration

### Environment Variables

```bash
# .env file
ENCRYPTION_KEY=your-64-character-hex-key-here
JWT_SECRET=your-jwt-secret-here
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
DB_PASSWORD=your-database-password
```

### Production Considerations

```typescript
// Production configuration example
storeConfiguration: {
  type: 'typeorm',
  options: {
    type: 'postgres',
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    synchronize: false, // Always false in production
    migrations: ['dist/migrations/*.js'],
    migrationsRun: true,
  },
  encryption: {
    encryptionKey: process.env.ENCRYPTION_KEY!,
    algorithm: 'aes-256-gcm',
  },
},
```

## Migration from Unencrypted Data

If you have existing unencrypted data and want to enable encryption:

1. **Backup Your Database**: Always backup before making changes
2. **Enable Encryption**: Update your configuration
3. **Graceful Handling**: The system will try to decrypt existing data and fall back to treating it as unencrypted if decryption fails

### Migration Script Example

```typescript
// migration-helper.ts
import { EncryptionService } from '@rekog/mcp-nest/authz';

const encryptionService = new EncryptionService({
  encryptionKey: process.env.ENCRYPTION_KEY!,
  algorithm: 'aes-256-gcm',
});

// Example of manually migrating existing data
async function migrateExistingData() {
  // Get all records with potentially unencrypted sensitive data
  // Encrypt and update them
  // This is a simplified example - implement based on your needs
}
```

## Troubleshooting

### Common Issues

1. **Invalid Key Length**:

   ```
   Error: Encryption key must be exactly 64 hex characters (32 bytes) for AES-256
   ```

   Solution: Use `EncryptionService.generateKey()` to generate a proper key.

2. **Decryption Failures**:

   - Check that the encryption key hasn't changed
   - Verify the algorithm matches what was used for encryption
   - For legacy data, the system will fall back to treating data as unencrypted

3. **Performance Impact**:
   - Encryption/decryption adds computational overhead
   - Consider the trade-off between security and performance
   - Use database indexes carefully (encrypted fields can't be efficiently indexed)

### Debugging

Enable debug logging to troubleshoot encryption issues:

```typescript
// Enable detailed logging
import { Logger } from '@nestjs/common';

// The EncryptionService and EncryptedTypeOrmStore log important events
// Check your application logs for encryption-related messages
```

## Disabling Encryption

To disable encryption while keeping the configuration structure:

```typescript
storeConfiguration: {
  type: 'typeorm',
  options: { /* database config */ },
  // Simply omit or comment out the encryption section
  // encryption: { ... },
},
```

Or explicitly disable by not providing an encryption key:

```typescript
storeConfiguration: {
  type: 'typeorm',
  options: { /* database config */ },
  encryption: {}, // Empty config = no encryption
},
```

## Testing

### Unit Testing with Encryption

```typescript
import { EncryptionService } from '@rekog/mcp-nest/authz';

describe('Encryption', () => {
  let encryptionService: EncryptionService;

  beforeEach(() => {
    encryptionService = new EncryptionService({
      encryptionKey: EncryptionService.generateKey(),
      algorithm: 'aes-256-gcm',
    });
  });

  it('should encrypt and decrypt data', async () => {
    const plaintext = 'sensitive data';
    const encrypted = await encryptionService.encrypt(plaintext);
    const decrypted = await encryptionService.decrypt(encrypted!);

    expect(decrypted).toBe(plaintext);
    expect(encrypted).not.toBe(plaintext);
  });
});
```

### Integration Testing

```typescript
// Test with actual OAuth store operations
// Verify that sensitive data is properly encrypted in database
// Verify that data is properly decrypted when retrieved
```

## Performance Considerations

### Encryption Overhead

- AES-256-GCM: ~10-20% overhead for small strings
- AES-256-CBC: ~5-15% overhead for small strings
- Larger overhead for very small strings due to IV and metadata

### Database Impact

- Encrypted data is larger (IV + ciphertext + auth tag)
- Cannot efficiently index encrypted fields
- Consider encrypting only truly sensitive fields

### Recommendations

- Use encryption for sensitive data only
- Keep non-sensitive searchable fields unencrypted
- Consider the performance vs security trade-off for your use case
