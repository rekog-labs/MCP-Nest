#!/usr/bin/env ts-node

import dotenv from 'dotenv';
import * as jwt from 'jsonwebtoken';

// Load environment variables
dotenv.config({ path: '../../.env' });

const SERVER_URL = 'http://localhost:3030';

// Test users with their JWT tokens
const testUsers = {
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
  admin: {
    sub: 'admin456',
    azp: 'mcp-client',
    scope: 'admin write read',
    iss: SERVER_URL,
    aud: 'mcp-server',
    type: 'access',
    name: 'Admin User',
    username: 'admin',
    displayName: 'Admin User',
  },
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
};

// Helper function to make MCP requests
async function makeMCPRequest(
  toolName: string,
  args: any = {},
  authToken?: string,
) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const body = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1000000),
    method: 'tools/call',
    params: {
      name: toolName,
      arguments: args,
    },
  };

  try {
    const response = await fetch(`${SERVER_URL}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const result = await response.json();
    return { success: response.ok, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Helper function to list tools
async function listTools(authToken?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const body = {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1000000),
    method: 'tools/list',
  };

  try {
    const response = await fetch(`${SERVER_URL}/mcp`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const result = await response.json();
    return { success: response.ok, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// JWT generation function (simplified version)
function generateJWTToken(payload: any): string {
  const JWT_SECRET =
    process.env.JWT_SECRET ||
    'your_super_secret_jwt_key_at_least_32_characters_long';
  return jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256' });
}

// Test scenarios
async function runTests() {
  console.log('🧪 Testing MCP Authorization\n');
  console.log(`Server URL: ${SERVER_URL}\n`);

  // Test 1: Protected tool without authentication
  console.log('📋 Test 1: Protected tool without authentication');
  const result1 = await makeMCPRequest('admin-greet', { message: 'test' });
  if (!result1.success && result1.data?.statusCode === 401) {
    console.log('✅ SUCCESS: Protected tool correctly rejected without auth');
    console.log(`   Error: ${result1.data.message}`);
  } else {
    console.log('❌ FAILED: Protected tool should require authentication');
    console.log(`   Response: ${JSON.stringify(result1)}`);
  }
  console.log('');

  // Test 2: Admin tool with admin JWT
  console.log('📋 Test 2: Admin tool with admin JWT');
  const adminToken = generateJWTToken(testUsers.admin);
  console.log('Admin Token:', adminToken);
  const result2 = await makeMCPRequest(
    'admin-greet',
    { message: 'Hello from admin!' },
    adminToken,
  );
  if (result2.success) {
    console.log('✅ SUCCESS: Admin tool accessible with admin JWT');
    console.log(
      `   Response: ${result2.data.result?.content?.[0]?.text || JSON.stringify(result2.data).substring(0, 100)}...`,
    );
  } else {
    console.log('❌ FAILED: Admin tool should be accessible with admin JWT');
    console.log(`   Error: ${JSON.stringify(result2.error || result2.data)}`);
  }
  console.log('');

  // Test 3: Premium tool with premium JWT
  console.log('📋 Test 3: Premium tool with premium JWT');
  const premiumToken = generateJWTToken(testUsers.premium);
  console.log('Premium Token:', premiumToken);
  const result3 = await makeMCPRequest(
    'premium-greet',
    { name: 'John', level: 'gold' },
    premiumToken,
  );
  if (result3.success) {
    console.log('✅ SUCCESS: Premium tool accessible with premium JWT');
    console.log(
      `   Response: ${result3.data.result?.content?.[0]?.text || JSON.stringify(result3.data).substring(0, 100)}...`,
    );
  } else {
    console.log(
      '❌ FAILED: Premium tool should be accessible with premium JWT',
    );
    console.log(`   Error: ${JSON.stringify(result3.error || result3.data)}`);
  }
  console.log('');

  // Test 4: Admin tool with insufficient scopes
  console.log('📋 Test 4: Admin tool with insufficient scopes');
  const basicToken = generateJWTToken(testUsers.basic);
  console.log('Basic Token:', basicToken);
  const result4 = await makeMCPRequest(
    'admin-greet',
    { message: 'test' },
    basicToken,
  );
  if (
    (result4.success &&
      result4.data?.error?.message?.includes('requires scopes')) ||
    (result4.success === false &&
      result4.data?.error?.message?.includes('requires scopes'))
  ) {
    console.log(
      '✅ SUCCESS: Admin tool correctly rejected for insufficient scopes',
    );
    console.log(
      `   Error: ${result4.data?.error?.message || result4.data?.message}`,
    );
  } else {
    console.log('❌ FAILED: Admin tool should reject insufficient scopes');
    console.log(`   Response: ${JSON.stringify(result4)}`);
  }
  console.log('');

  // Test 5: Premium tool with insufficient roles
  console.log('📋 Test 5: Premium tool with insufficient roles');
  const result5 = await makeMCPRequest(
    'premium-greet',
    { name: 'John', level: 'gold' },
    basicToken,
  );
  if (
    (result5.success &&
      result5.data?.error?.message?.includes('requires roles')) ||
    (result5.success === false &&
      result5.data?.error?.message?.includes('requires roles'))
  ) {
    console.log(
      '✅ SUCCESS: Premium tool correctly rejected for insufficient roles',
    );
    console.log(
      `   Error: ${result5.data?.error?.message || result5.data?.message}`,
    );
  } else {
    console.log('❌ FAILED: Premium tool should reject insufficient roles');
    console.log(`   Response: ${JSON.stringify(result5)}`);
  }
  console.log('');

  // Test 6: Super admin tool with super admin JWT
  console.log('📋 Test 6: Super admin tool with super admin JWT');
  const superAdminToken = generateJWTToken(testUsers.superAdmin);
  console.log('Super Admin Token:', superAdminToken);
  const result6 = await makeMCPRequest(
    'super-admin-greet',
    { target: 'User123', action: 'approve' },
    superAdminToken,
  );
  if (result6.success) {
    console.log('✅ SUCCESS: Super admin tool accessible with super admin JWT');
    console.log(
      `   Response: ${result6.data.result?.content?.[0]?.text || JSON.stringify(result6.data).substring(0, 100)}...`,
    );
  } else {
    console.log(
      '❌ FAILED: Super admin tool should be accessible with super admin JWT',
    );
    console.log(`   Error: ${JSON.stringify(result6.error || result6.data)}`);
  }
  console.log('');

  // Test 7: Super admin tool with admin JWT (missing super-admin role)
  console.log(
    '📋 Test 7: Super admin tool with admin JWT (missing super-admin role)',
  );
  const result7 = await makeMCPRequest(
    'super-admin-greet',
    { target: 'User123', action: 'approve' },
    adminToken,
  );
  if (
    (result7.success &&
      result7.data?.error?.message?.includes('requires roles')) ||
    (result7.success === false &&
      result7.data?.error?.message?.includes('requires roles')) ||
    (result7.success &&
      result7.data?.error?.message?.includes('requires scopes')) ||
    (result7.success === false &&
      result7.data?.error?.message?.includes('requires scopes'))
  ) {
    console.log(
      '✅ SUCCESS: Super admin tool correctly rejected for missing role',
    );
    console.log(
      `   Error: ${result7.data?.error?.message || result7.data?.message}`,
    );
  } else {
    console.log(
      '❌ FAILED: Super admin tool should reject missing super-admin role',
    );
    console.log(`   Response: ${JSON.stringify(result7)}`);
  }
  console.log('');

  // Test 8: List tools with super admin authentication
  console.log('📋 Test 8: List tools with super admin authentication');
  const result8 = await listTools(superAdminToken);
  if (result8.success) {
    const toolNames = result8.data.result?.tools?.map((t: any) => t.name) || [];
    const hasAllTools =
      toolNames.includes('greet-logged-in-user') &&
      toolNames.includes('greet-world') &&
      toolNames.includes('public-greet-world') &&
      toolNames.includes('greet-user') &&
      toolNames.includes('greet-user-interactive') &&
      toolNames.includes('greet-user-structured') &&
      toolNames.includes('admin-greet') &&
      toolNames.includes('super-admin-greet');
    if (hasAllTools) {
      console.log(
        '✅ SUCCESS: All tools visible with super admin authentication',
      );
      console.log(`   Visible tools: ${toolNames.join(', ')}`);
    } else {
      console.log(
        '⚠️  PARTIAL: Tools listed but may be missing some protected tools',
      );
      console.log(`   Visible tools: ${toolNames.join(', ')}`);
    }
  } else {
    console.log(
      '❌ FAILED: Should be able to list all tools with authentication',
    );
    console.log(`   Error: ${JSON.stringify(result8.error || result8.data)}`);
  }
}

// Run the tests
runTests().catch(console.error);
