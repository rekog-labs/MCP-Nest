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
export function mintFakeToken(
  user: FakeUser,
  jwtSecret: string,
  resource: string,
): string {
  const payload = {
    sub: user.sub,
    type: 'access' as const,
    scope: user.scope,
    resource,
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
