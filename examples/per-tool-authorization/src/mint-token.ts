import jwt from 'jsonwebtoken';
import { JWT_SECRET } from './jwt-secret';

const users: Record<string, object> = {
  admin: {
    sub: 'admin123',
    name: 'Admin User',
    scope: 'admin write read',
    scopes: ['admin', 'write', 'read'],
    roles: ['admin', 'user'],
  },
  basic: {
    sub: 'user123',
    name: 'Basic User',
    scope: 'read',
    scopes: ['read'],
    roles: ['user'],
  },
  premium: {
    sub: 'premium123',
    name: 'Premium User',
    scope: 'read premium',
    scopes: ['read', 'premium'],
    roles: ['user'],
  },
};

const who = process.argv[2] ?? 'basic';
const payload = users[who];
if (!payload) {
  console.error(`Unknown profile "${who}". Choose one of: ${Object.keys(users).join(', ')}`);
  process.exit(1);
}

console.log(jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' }));
