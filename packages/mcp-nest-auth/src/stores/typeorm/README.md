# TypeORM OAuth Store Implementation

This directory contains a TypeORM implementation of the `IOAuthStore` interface for persistent OAuth data storage.

## Features

- **Persistent Storage**: Unlike the in-memory store, data survives server restarts
- **Database Support**: Works with any database supported by TypeORM (PostgreSQL, MySQL, SQLite, etc.)
- **Automatic Schema Management**: Entities automatically create the required database tables
- **Expiration Handling**: Automatic cleanup of expired sessions and authorization codes

## Entities

### OAuthClientEntity
Stores OAuth client information including:
- Client credentials and metadata
- Redirect URIs and grant types
- Creation and update timestamps

### AuthorizationCodeEntity
Stores authorization codes with:
- Code challenge and method for PKCE
- Expiration and usage tracking
- Associated user and client information

### OAuthSessionEntity
Stores OAuth session data including:
- Session state and parameters
- Expiration handling
- Client association

### OAuthUserProfileEntity
Stores normalized user profile information per provider:
- Stable `profile_id` primary key
- `provider_user_id` and `provider`
- `username`, `email`, `displayName`, `avatarUrl`
- `raw` stringified provider payload

## Usage

### Basic SQLite Configuration

```typescript
McpOAuthModule.forRoot({
  provider: GoogleOAuthProvider,
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  jwtSecret: process.env.JWT_SECRET!,
  typeormOptions: {
    type: 'sqlite',
    database: 'oauth.db',
    synchronize: true,
    logging: false,
  },
})
```

### PostgreSQL Configuration

```typescript
McpOAuthModule.forRoot({
  provider: GoogleOAuthProvider,
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  jwtSecret: process.env.JWT_SECRET!,
  typeormOptions: {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'oauth_db',
    synchronize: process.env.NODE_ENV !== 'production',
    logging: process.env.NODE_ENV === 'development',
  },
})
```

### MySQL Configuration

```typescript
McpOAuthModule.forRoot({
  provider: GoogleOAuthProvider,
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  jwtSecret: process.env.JWT_SECRET!,
  typeormOptions: {
    type: 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    username: process.env.DB_USERNAME || 'root',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'oauth_db',
    synchronize: process.env.NODE_ENV !== 'production',
    logging: process.env.NODE_ENV === 'development',
  },
})
```

## Configuration Options

All standard TypeORM options are supported:

- `type`: Database type (sqlite, postgres, mysql, etc.)
- `host`: Database host
- `port`: Database port
- `username`: Database username
- `password`: Database password
- `database`: Database name or file path (for SQLite)
- `synchronize`: Auto-create tables (disable in production)
- `logging`: Enable query logging
- `entities`: Additional entities (OAuth entities are automatically included)
- `migrations`: Database migrations
- `ssl`: SSL configuration for production databases

## Production Considerations

1. **Disable synchronize**: Use migrations instead of auto-sync in production
2. **Enable SSL**: Configure SSL for production database connections
3. **Connection Pooling**: Configure appropriate connection pool settings
4. **Logging**: Disable query logging in production for performance
5. **Backup Strategy**: Implement regular database backups

## Migrations

For production use, create migrations instead of using `synchronize: true`:

```bash
npx typeorm migration:generate -n CreateOAuthTables
npx typeorm migration:run
```

## Interface Compatibility

The TypeORM implementation provides both synchronous and asynchronous methods:

- Synchronous methods (for IOAuthStore compatibility): Log warnings and use fire-and-forget async operations
- Asynchronous methods (recommended): `*Async` versions that return promises

Consider updating your application to use the async methods for better error handling and performance.