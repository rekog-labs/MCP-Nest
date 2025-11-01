#!/usr/bin/env ts-node

// run with:
// `npx ts-node playground/clients/utils/generate-test-jwts.ts`
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: '../.env' });

const JWT_SECRET =
  process.env.JWT_SECRET ||
  'your_super_secret_jwt_key_at_least_32_characters_long';
const SERVER_URL = 'http://localhost:3030';

// JWT payload interface
interface JwtPayload {
  sub: string;
  azp: string;
  scope?: string;
  roles?: string[];
  iss: string;
  aud: string;
  type: string;
  name: string;
  username: string;
  displayName: string;
  iat?: number;
  exp?: number;
}

// Generate JWT token
function generateJWT(payload: JwtPayload, expiresIn?: string): string {
  const options: jwt.SignOptions = {
    algorithm: 'HS256',
    expiresIn: '100y',
  };

  if (expiresIn) {
    options.expiresIn = expiresIn;
  }

  return jwt.sign(payload, JWT_SECRET, options);
}

// Define test users with different authorization levels
const testUsers = {
  // Unauthenticated user (no JWT needed)
  public: null,

  // Basic authenticated user (no special scopes or roles)
  basic: {
    sub: 'user123',
    azp: 'mcp-client',
    iss: SERVER_URL,
    aud: 'mcp-server',
    type: 'access',
    name: 'Basic User',
    username: 'basicuser',
    displayName: 'Basic User',
  },

  // Admin user with admin scopes
  admin: {
    sub: 'admin456',
    azp: 'mcp-client',
    scope: 'admin write read',
    roles: ['admin'],
    iss: SERVER_URL,
    aud: 'mcp-server',
    type: 'access',
    name: 'Admin User',
    username: 'admin',
    displayName: 'Admin User',
  },

  // Premium user with premium role
  premium: {
    sub: 'premium789',
    azp: 'mcp-client',
    scope: 'read write',
    roles: ['premium'],
    iss: SERVER_URL,
    aud: 'mcp-server',
    type: 'access',
    name: 'Premium User',
    username: 'premiumuser',
    displayName: 'Premium User',
  },

  // Super admin with both admin scopes AND super-admin role
  superAdmin: {
    sub: 'superadmin000',
    azp: 'mcp-client',
    scope: 'admin write delete read',
    roles: ['super-admin', 'admin'],
    iss: SERVER_URL,
    aud: 'mcp-server',
    type: 'access',
    name: 'Super Admin',
    username: 'superadmin',
    displayName: 'Super Admin',
  },

  // User with insufficient scopes (missing admin scope)
  insufficientScopes: {
    sub: 'user111',
    azp: 'mcp-client',
    scope: 'read write', // Missing 'admin' scope
    iss: SERVER_URL,
    aud: 'mcp-server',
    type: 'access',
    name: 'Insufficient Scopes User',
    username: 'insufficientscopes',
    displayName: 'Insufficient Scopes User',
  },

  // User with insufficient roles (missing premium role)
  insufficientRoles: {
    sub: 'user222',
    azp: 'mcp-client',
    scope: 'read write',
    roles: ['user'], // Missing 'premium' role
    iss: SERVER_URL,
    aud: 'mcp-server',
    type: 'access',
    name: 'Insufficient Roles User',
    username: 'insufficientroles',
    displayName: 'Insufficient Roles User',
  },

  // User with partial admin access (has scopes but not super-admin role)
  partialAdmin: {
    sub: 'user333',
    azp: 'mcp-client',
    scope: 'admin write delete read', // Has all required scopes
    roles: ['admin'], // Missing 'super-admin' role
    iss: SERVER_URL,
    aud: 'mcp-server',
    type: 'access',
    name: 'Partial Admin',
    username: 'partialadmin',
    displayName: 'Partial Admin',
  },
};

console.log('🔐 JWT Token Generator for MCP Authorization Testing\n');
console.log(`Server URL: ${SERVER_URL}`);
console.log(`JWT Secret: ${JWT_SECRET.substring(0, 10)}...\n`);

// Generate tokens for each test user
Object.entries(testUsers).forEach(([key, payload]) => {
  console.log(`📋 ${key.toUpperCase()} USER:`);

  if (payload === null) {
    console.log('  No JWT token needed (unauthenticated access)');
    console.log(
      '  Can access: public-greet-world, greet-world, greet-user, greet-user-interactive, greet-user-structured',
    );
    console.log('');
    return;
  }

  const token = generateJWT(payload as JwtPayload); // No expiry for testing
  console.log(`  JWT Token: ${token}`);
  console.log(`  User Info: ${payload.name} (${payload.username})`);

  if ('scope' in payload && payload.scope) {
    console.log(`  Scopes: ${payload.scope}`);
  }

  if ('roles' in payload && payload.roles) {
    console.log(`  Roles: ${(payload.roles as string[]).join(', ')}`);
  }

  // Expected access based on authorization
  console.log('  Expected Access:');

  if (key === 'basic') {
    console.log('    ✅ public-greet-world (Public)');
    console.log('    ✅ greet-logged-in-user (Authenticated)');
    console.log('    ✅ greet-world (No auth required)');
    console.log('    ✅ greet-user (No auth required)');
    console.log('    ❌ admin-greet (Missing admin scopes)');
    console.log('    ❌ premium-greet (Missing premium role)');
    console.log('    ❌ super-admin-greet (Missing scopes + role)');
  } else if (key === 'admin') {
    console.log('    ✅ public-greet-world (Public)');
    console.log('    ✅ greet-logged-in-user (Authenticated)');
    console.log('    ✅ greet-world (No auth required)');
    console.log('    ✅ greet-user (No auth required)');
    console.log('    ✅ admin-greet (Has admin + write scopes)');
    console.log('    ❌ premium-greet (Missing premium role)');
    console.log('    ❌ super-admin-greet (Missing super-admin role)');
  } else if (key === 'premium') {
    console.log('    ✅ public-greet-world (Public)');
    console.log('    ✅ greet-logged-in-user (Authenticated)');
    console.log('    ✅ greet-world (No auth required)');
    console.log('    ✅ greet-user (No auth required)');
    console.log('    ❌ admin-greet (Missing admin scopes)');
    console.log('    ✅ premium-greet (Has premium role)');
    console.log(
      '    ❌ super-admin-greet (Missing admin scopes + super-admin role)',
    );
  } else if (key === 'superAdmin') {
    console.log('    ✅ public-greet-world (Public)');
    console.log('    ✅ greet-logged-in-user (Authenticated)');
    console.log('    ✅ greet-world (No auth required)');
    console.log('    ✅ greet-user (No auth required)');
    console.log('    ✅ admin-greet (Has admin + write scopes)');
    console.log('    ✅ premium-greet (Has premium role)');
    console.log(
      '    ✅ super-admin-greet (Has all admin scopes + super-admin role)',
    );
  } else if (key === 'insufficientScopes') {
    console.log('    ✅ public-greet-world (Public)');
    console.log('    ✅ greet-logged-in-user (Authenticated)');
    console.log('    ✅ greet-world (No auth required)');
    console.log('    ✅ greet-user (No auth required)');
    console.log('    ❌ admin-greet (Missing admin scope)');
    console.log('    ❌ premium-greet (Missing premium role)');
    console.log(
      '    ❌ super-admin-greet (Missing admin scopes + super-admin role)',
    );
  } else if (key === 'insufficientRoles') {
    console.log('    ✅ public-greet-world (Public)');
    console.log('    ✅ greet-logged-in-user (Authenticated)');
    console.log('    ✅ greet-world (No auth required)');
    console.log('    ✅ greet-user (No auth required)');
    console.log('    ❌ admin-greet (Missing admin scopes)');
    console.log('    ❌ premium-greet (Missing premium role)');
    console.log(
      '    ❌ super-admin-greet (Missing admin scopes + super-admin role)',
    );
  } else if (key === 'partialAdmin') {
    console.log('    ✅ public-greet-world (Public)');
    console.log('    ✅ greet-logged-in-user (Authenticated)');
    console.log('    ✅ greet-world (No auth required)');
    console.log('    ✅ greet-user (No auth required)');
    console.log('    ✅ admin-greet (Has admin + write scopes)');
    console.log('    ❌ premium-greet (Missing premium role)');
    console.log('    ❌ super-admin-greet (Missing super-admin role)');
  }

  console.log('');
});

console.log('🧪 Usage Examples:\n');

console.log('1. Test without authentication (public access only):');
console.log('   curl -X POST http://localhost:3030/mcp \\');
console.log('     -H "Content-Type: application/json" \\');
console.log(
  '     -d \'{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"public-greet-world","arguments":{}}}\'\n',
);

console.log('2. Test with admin JWT:');
console.log(`   curl -X POST http://localhost:3030/mcp \\`);
console.log(`     -H "Content-Type: application/json" \\`);
console.log(
  `     -H "Authorization: Bearer ${generateJWT(testUsers.admin as JwtPayload)}" \\`,
);
console.log(
  `     -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"admin-greet","arguments":{"message":"Hello Admin"}}}'\n`,
);

console.log('3. Test with premium JWT:');
console.log(`   curl -X POST http://localhost:3030/mcp \\`);
console.log(`     -H "Content-Type: application/json" \\`);
console.log(
  `     -H "Authorization: Bearer ${generateJWT(testUsers.premium as JwtPayload)}" \\`,
);
console.log(
  `     -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"premium-greet","arguments":{"name":"John","level":"gold"}}}'\n`,
);

console.log('4. Test with super admin JWT:');
console.log(`   curl -X POST http://localhost:3030/mcp \\`);
console.log(`     -H "Content-Type: application/json" \\`);
console.log(
  `     -H "Authorization: Bearer ${generateJWT(testUsers.superAdmin as JwtPayload)}" \\`,
);
console.log(
  `     -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"super-admin-greet","arguments":{"target":"User123","action":"approve"}}}'\n`,
);

console.log('5. List tools visible to different users:');
console.log('   # Unauthenticated - only public tools');
console.log(
  '   curl -X POST http://localhost:3030/mcp -H "Content-Type: application/json" -d \'{"jsonrpc":"2.0","id":5,"method":"tools/list"}\'\n',
);
console.log('   # Authenticated - all tools they can access');
console.log(
  `   curl -X POST http://localhost:3030/mcp -H "Content-Type: application/json" -H "Authorization: Bearer ${generateJWT(testUsers.superAdmin as JwtPayload)}" -d '{"jsonrpc":"2.0","id":6,"method":"tools/list"}'\n`,
);
