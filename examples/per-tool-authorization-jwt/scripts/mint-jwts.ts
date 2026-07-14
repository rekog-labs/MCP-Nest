import * as jwt from 'jsonwebtoken';

const JWT_SECRET =
  process.env.JWT_SECRET ??
  'your_super_secret_jwt_key_at_least_32_characters_long';

function sign(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '10y' });
}

const BASIC_USER = sign({
  sub: 'user123',
  name: 'Basic User',
  username: 'basicuser',
  displayName: 'Basic User',
});

const ADMIN_USER = sign({
  sub: 'admin456',
  name: 'Admin User',
  username: 'admin',
  displayName: 'Admin User',
  scope: 'admin write read',
  scopes: ['admin', 'write', 'read'],
  roles: ['admin'],
});

const PREMIUM_USER = sign({
  sub: 'premium789',
  name: 'Premium User',
  username: 'premiumuser',
  displayName: 'Premium User',
  scope: 'read write',
  scopes: ['read', 'write'],
  roles: ['premium'],
});

const SUPERADMIN_USER = sign({
  sub: 'superadmin000',
  name: 'Super Admin',
  username: 'superadmin',
  displayName: 'Super Admin',
  scope: 'admin write delete read',
  scopes: ['admin', 'write', 'delete', 'read'],
  roles: ['super-admin', 'admin', 'premium'],
});

console.log(`export BASIC_USER=${BASIC_USER}`);
console.log(`export ADMIN_USER=${ADMIN_USER}`);
console.log(`export PREMIUM_USER=${PREMIUM_USER}`);
console.log(`export SUPERADMIN_USER=${SUPERADMIN_USER}`);
