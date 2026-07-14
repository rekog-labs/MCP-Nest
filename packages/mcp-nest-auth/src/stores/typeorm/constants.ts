// Unique TypeORM connection name used by the OAuth store to avoid
// collisions with an application's own connections.
export const OAUTH_TYPEORM_CONNECTION_NAME = '@rekog/mcp-nest-auth:oauth';

// Table name prefix to avoid collisions with application tables.
export const OAUTH_TABLE_PREFIX = 'rekog_mcp_auth_';
