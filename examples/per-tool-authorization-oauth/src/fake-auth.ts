import * as jwt from 'jsonwebtoken';

export interface FakeUser {
  sub: string;
  username: string;
  displayName: string;
  scope: string;
  roles: string[];
}

export const FAKE_USERS: Record<string, FakeUser> = {
  BASIC_USER: {
    sub: 'basic-user',
    username: 'basic',
    displayName: 'Basic User',
    scope: 'read',
    roles: ['user'],
  },
  ADMIN_USER: {
    sub: 'admin-user',
    username: 'admin',
    displayName: 'Admin User',
    scope: 'admin write read',
    roles: ['admin', 'user'],
  },
  PREMIUM_USER: {
    sub: 'premium-user',
    username: 'premium',
    displayName: 'Premium User',
    scope: 'read write',
    roles: ['premium', 'user'],
  },
  SUPERADMIN_USER: {
    sub: 'superadmin-user',
    username: 'superadmin',
    displayName: 'Super Admin User',
    scope: 'admin write delete read',
    roles: ['super-admin', 'admin', 'user'],
  },
};

// Mint a JWT in the exact shape McpAuthJwtGuard/JwtTokenService expect:
// HS256, signed with the same jwtSecret the module was configured with. The
// guard reads `scope` (space-delimited) and `user_data.roles`, and derives
// username/displayName/name from `user_data`.
//
// `iss` and `aud` are not decoration: JwtTokenService validates the issuer on
// every token and the audience on every bearer token (RFC 8707 §2), so `issuer`
// must be the module's configured `serverUrl` and `resource` its configured
// `resource`, or the guard answers 401.
export function mintFakeToken(
  user: FakeUser,
  jwtSecret: string,
  resource: string,
  issuer: string,
): string {
  const payload = {
    sub: user.sub,
    type: 'access' as const,
    scope: user.scope,
    resource,
    iss: issuer,
    aud: resource,
    user_data: {
      username: user.username,
      displayName: user.displayName,
      roles: user.roles,
    },
  };
  return jwt.sign(payload, jwtSecret, {
    algorithm: 'HS256',
    expiresIn: '24h',
  });
}
