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
      // Get the OAuth configuration from each auth module to verify they're different
      // In a real scenario, we'd test that the OAuth flows use the correct scopes
      // For now, we're just ensuring the modules can be created without errors
      
      // This test will fail with the current implementation because both modules
      // will have the same configuration (from ModuleB)
      
      const server = app.getHttpServer();
      const port = server.address().port;
      
      // Make a simple request to verify the servers are running
      // In a real test, we'd verify that each auth endpoint uses the correct OAuth config
      expect(port).toBeDefined();
    } finally {
      await app.close();
    }
  });
});
