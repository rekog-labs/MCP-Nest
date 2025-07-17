// Re-export main interfaces
export * from '../providers/oauth-provider.interface';
export * from '../stores/oauth-store.interface';

/**
 * @fileoverview Store Configuration Examples
 *
 * The `storeConfiguration` property in `OAuthUserModuleOptions` allows you to configure
 * how OAuth sessions, authorization codes, and client information are stored.
 *
 * @example
 * // Option 1: Memory Store (default)
 * // Just omit storeConfiguration or explicitly set it
 * storeConfiguration: { type: 'memory' }
 *
 * @example
 * // Option 2: Custom Store Implementation
 * import { MyCustomStore } from './my-custom-store';
 * storeConfiguration: {
 *   type: 'custom',
 *   store: new MyCustomStore()
 * }
 *
 * @example
 * // Option 3: TypeORM Persistent Storage
 * storeConfiguration: {
 *   type: 'typeorm',
 *   options: {
 *     type: 'sqlite',
 *     database: './oauth.db',
 *     synchronize: true,
 *     logging: false
 *   }
 * }
 *
 * @example
 * // Option 3b: TypeORM with PostgreSQL
 * storeConfiguration: {
 *   type: 'typeorm',
 *   options: {
 *     type: 'postgres',
 *     host: process.env.DB_HOST || 'localhost',
 *     port: parseInt(process.env.DB_PORT) || 5432,
 *     username: process.env.DB_USERNAME || 'postgres',
 *     password: process.env.DB_PASSWORD || 'password',
 *     database: process.env.DB_NAME || 'oauth_db',
 *     synchronize: process.env.NODE_ENV !== 'production',
 *     logging: process.env.NODE_ENV === 'development'
 *   }
 * }
 */
