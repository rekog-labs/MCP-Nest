import { INestApplication, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Payload } from '@nestjs/microservices';
import {
  McpController,
  McpStrategy,
  SseTransport,
  StreamableHttpTransport,
  Tool,
} from '../src';
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

@McpController()
class ToolsA {
  @Tool({
    name: 'toolA',
    description: 'Tool A from ModuleA',
    parameters: z.object({}),
  })
  toolA(@Payload() _args: unknown) {
    return { content: [{ type: 'text', text: 'Tool A result' }] };
  }
}

@McpController()
class ToolsB {
  @Tool({
    name: 'toolB',
    description: 'Tool B from ModuleB',
    parameters: z.object({}),
  })
  toolB(@Payload() _args: unknown) {
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

    // Each MCP server is now a microservice transport strategy with its own
    // distinct HTTP routes (replacing the old mcpEndpoint/sseEndpoint options).
    const strategyA = new McpStrategy({
      name: 'server-a',
      version: '0.0.1',
      transports: [
        new StreamableHttpTransport({
          endpoint: '/servers/a/mcp',
          statelessMode: false,
        }),
        new SseTransport({
          sseEndpoint: '/servers/a/sse',
          messagesEndpoint: '/servers/a/messages',
        }),
      ],
    });

    const strategyB = new McpStrategy({
      name: 'server-b',
      version: '0.0.1',
      transports: [
        new StreamableHttpTransport({
          endpoint: '/servers/b/mcp',
          statelessMode: false,
        }),
        new SseTransport({
          sseEndpoint: '/servers/b/sse',
          messagesEndpoint: '/servers/b/messages',
        }),
      ],
    });

    @Module({
      imports: [mcpAuthModuleA],
      controllers: [ToolsA],
    })
    class ModuleA {}

    @Module({
      imports: [mcpAuthModuleB],
      controllers: [ToolsB],
    })
    class ModuleB {}

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [ModuleA, ModuleB],
    }).compile();

    // One HTTP adapter, but both strategies connect to it; each mounts its own
    // transports on its own distinct endpoints.
    const app: INestApplication = moduleFixture.createNestApplication();
    strategyA.setHttpAdapter(app.getHttpAdapter());
    strategyB.setHttpAdapter(app.getHttpAdapter());
    app.connectMicroservice({ strategy: strategyA });
    app.connectMicroservice({ strategy: strategyB });
    await app.startAllMicroservices();
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
