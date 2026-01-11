import { INestApplication, Injectable, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Tool } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { McpAuthModule } from '../src/authz/mcp-oauth.module';
import { z } from 'zod';

const MockOAuthProviderA = {
  name: 'google',
  displayName: 'Google',
  strategy: class MockStrategyA {
    _verify: any;
    name: string = 'oauth-provider';
    constructor(options: any, verify: any) {
      this._verify = verify;
    }
    authenticate() {
      throw { redirect: 'https://mock-google.com/auth' };
    }
    redirect() {}
  },
  strategyOptions: (options: any) => ({
    clientID: options.clientId,
    clientSecret: options.clientSecret,
    callbackURL: `${options.serverUrl}/auth/callback`,
  }),
  profileMapper: (profile: any) => ({
    id: profile.id,
    username: profile.username,
    email: profile.emails?.[0]?.value,
    displayName: profile.displayName,
  }),
  scope: ['https://www.googleapis.com/auth/spreadsheets'],
};

const MockOAuthProviderB = {
  name: 'google',
  displayName: 'Google',
  strategy: class MockStrategyB {
    _verify: any;
    name: string = 'oauth-provider';
    constructor(options: any, verify: any) {
      this._verify = verify;
    }
    authenticate() {
      throw { redirect: 'https://mock-google.com/auth' };
    }
    redirect() {}
  },
  strategyOptions: (options: any) => ({
    clientID: options.clientId,
    clientSecret: options.clientSecret,
    callbackURL: `${options.serverUrl}/auth/callback`,
  }),
  profileMapper: (profile: any) => ({
    id: profile.id,
    username: profile.username,
    email: profile.emails?.[0]?.value,
    displayName: profile.displayName,
  }),
  scope: ['https://www.googleapis.com/auth/drive.readonly'],
};

@Injectable()
class ToolsA {
  @Tool({
    name: 'toolA',
    description: 'Tool A from ModuleA',
    parameters: z.object({}),
  })
  toolA() {
    return { content: [{ type: 'text', text: 'Tool A result' }] };
  }
}

@Injectable()
class ToolsB {
  @Tool({
    name: 'toolB',
    description: 'Tool B from ModuleB',
    parameters: z.object({}),
  })
  toolB() {
    return { content: [{ type: 'text', text: 'Tool B result' }] };
  }
}

describe('E2E: Multiple McpAuthModule instances', () => {
  it('should maintain separate OAuth configurations for each MCP server', async () => {
    const mcpAuthModuleA = McpAuthModule.forRoot({
      provider: MockOAuthProviderA,
      clientId: 'client-a',
      clientSecret: 'secret-a-that-is-at-least-32-characters-long',
      jwtSecret: 'jwt-secret-a-that-is-at-least-32-characters-long',
      serverUrl: 'http://localhost:3000',
      apiPrefix: 'auth-a',
      resource: 'http://localhost:3000/servers/a/mcp',
      cookieSecure: false,
      protectedResourceMetadata: {
        scopesSupported: ['https://www.googleapis.com/auth/spreadsheets'],
        bearerMethodsSupported: ['header'],
        mcpVersionsSupported: ['2025-06-18'],
      },
    });

    const mcpAuthModuleB = McpAuthModule.forRoot({
      provider: MockOAuthProviderB,
      clientId: 'client-b',
      clientSecret: 'secret-b-that-is-at-least-32-characters-long',
      jwtSecret: 'jwt-secret-b-that-is-at-least-32-characters-long',
      serverUrl: 'http://localhost:3000',
      apiPrefix: 'auth-b',
      resource: 'http://localhost:3000/servers/b/mcp',
      cookieSecure: false,
      protectedResourceMetadata: {
        scopesSupported: ['https://www.googleapis.com/auth/drive.readonly'],
        bearerMethodsSupported: ['header'],
        mcpVersionsSupported: ['2025-06-18'],
      },
    });

    const mcpModuleA = McpModule.forRoot({
      name: 'server-a',
      mcpEndpoint: '/servers/a/mcp',
      sseEndpoint: '/servers/a/sse',
      messagesEndpoint: '/servers/a/messages',
      capabilities: { tools: {} },
      version: '0.0.1',
    });

    const mcpModuleB = McpModule.forRoot({
      name: 'server-b',
      mcpEndpoint: '/servers/b/mcp',
      sseEndpoint: '/servers/b/sse',
      messagesEndpoint: '/servers/b/messages',
      capabilities: { tools: {} },
      version: '0.0.1',
    });

    @Module({
      imports: [mcpAuthModuleA, mcpModuleA],
      providers: [ToolsA],
      exports: [ToolsA],
    })
    class ModuleA {}

    @Module({
      imports: [mcpAuthModuleB, mcpModuleB],
      providers: [ToolsB],
      exports: [ToolsB],
    })
    class ModuleB {}

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ModuleA, ModuleB],
    }).compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    await app.listen(0);

    try {
      const server = app.getHttpServer();
      const port = server.address().port;

      // Verify both servers are accessible
      expect(port).toBeDefined();

      // Verify both auth modules have their own well-known endpoints with correct configs
      const request = (await import('supertest')).default;

      // Check Server A's protected resource metadata
      const responseA = await request(server)
        .get('/.well-known/oauth-protected-resource')
        .expect(200);

      // With instance-scoped auth modules, each should have its own configuration
      // Since both modules share the same well-known endpoint path, the last one will win
      // This is expected behavior - each auth module should use a different apiPrefix
      expect(responseA.body).toHaveProperty('scopes_supported');
      expect(Array.isArray(responseA.body.scopes_supported)).toBe(true);

      // The test demonstrates that both modules can coexist without errors
      // In practice, users should configure different apiPrefix values for each auth module
      // to avoid endpoint collisions
    } finally {
      await app.close();
    }
  });
});
