import { INestApplication, Injectable } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { z } from 'zod';
import { Tool, PublicTool, ToolScopes, ToolRoles } from '../src';
import { McpModule } from '../src/mcp/mcp.module';
import { CanActivate, ExecutionContext } from '@nestjs/common';
import { createSseClient } from './utils';

// Mock authentication guard that sets user with scopes and roles
// This guard allows unauthenticated requests through, but enriches
// the request with user data if a valid token is present
class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      // Allow request through without user context
      // Per-tool authorization will decide if this is OK
      return true;
    }

    // Parse token to set different user contexts
    if (authHeader.includes('admin-token')) {
      request.user = {
        sub: 'admin123',
        name: 'Admin User',
        scope: 'admin write read', // Space-delimited as per OAuth 2.0 spec
        scopes: ['admin', 'write', 'read'], // Also as array for convenience
        roles: ['admin', 'user'],
      };
      return true;
    }

    if (authHeader.includes('basic-token')) {
      request.user = {
        sub: 'user123',
        name: 'Basic User',
        scope: 'read',
        scopes: ['read'],
        roles: ['user'],
      };
      return true;
    }

    if (authHeader.includes('premium-token')) {
      request.user = {
        sub: 'premium123',
        name: 'Premium User',
        scope: 'read premium',
        scopes: ['read', 'premium'],
        roles: ['user'],
      };
      return true;
    }

    // Unknown token - reject
    return false;
  }
}

@Injectable()
export class PerToolAuthTools {
  // Public tool - accessible to everyone
  @Tool({
    name: 'public-search',
    description: 'Search publicly available data',
  })
  @PublicTool()
  async publicSearch() {
    return {
      content: [
        {
          type: 'text',
          text: 'Public search results',
        },
      ],
    };
  }

  // Protected tool - requires authentication (module has guards)
  @Tool({
    name: 'user-profile',
    description: 'Get user profile',
  })
  async getUserProfile(args, context, request: any) {
    return {
      content: [
        {
          type: 'text',
          text: `Profile for ${request.user.name}`,
        },
      ],
    };
  }

  // Requires specific scopes
  @Tool({
    name: 'admin-delete',
    description: 'Delete user (admin only)',
  })
  @ToolScopes(['admin', 'write'])
  async deleteUser() {
    return {
      content: [
        {
          type: 'text',
          text: 'User deleted',
        },
      ],
    };
  }

  // Requires specific roles
  @Tool({
    name: 'system-config',
    description: 'Configure system (admin role)',
  })
  @ToolRoles(['admin'])
  async configureSystem() {
    return {
      content: [
        {
          type: 'text',
          text: 'System configured',
        },
      ],
    };
  }

  // Optional auth - works better with premium scope
  @Tool({
    name: 'smart-search',
    description: 'Smart search with optional premium features',
  })
  @PublicTool()
  @ToolScopes(['premium'])
  async smartSearch(args, context, request: any) {
    if (request.user?.scopes?.includes('premium')) {
      return {
        content: [
          {
            type: 'text',
            text: 'AI-powered premium search results',
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: 'Basic search results',
        },
      ],
    };
  }

  // Requires premium scope (no public fallback)
  @Tool({
    name: 'premium-feature',
    description: 'Premium-only feature',
  })
  @ToolScopes(['premium'])
  async premiumFeature() {
    return {
      content: [
        {
          type: 'text',
          text: 'Premium feature accessed',
        },
      ],
    };
  }
}

describe('E2E: Per-Tool Authorization', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        McpModule.forRoot({
          name: 'test-per-tool-auth-server',
          version: '0.0.1',
          guards: [MockAuthGuard],
          allowUnauthenticatedAccess: true, // Enable freemium mode for testing @PublicTool() tools
        }),
      ],
      providers: [PerToolAuthTools, MockAuthGuard],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.listen(0);

    const server = app.getHttpServer();
    testPort = server.address().port;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Tool Listing with Authorization', () => {
    it('should list only public tools when not authenticated', async () => {
      const client = await createSseClient(testPort);

      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name);

      // Should only see public tools
      expect(toolNames).toContain('public-search');
      expect(toolNames).toContain('smart-search'); // Has @PublicTool()

      // Should NOT see protected tools
      expect(toolNames).not.toContain('user-profile');
      expect(toolNames).not.toContain('admin-delete');
      expect(toolNames).not.toContain('system-config');
      expect(toolNames).not.toContain('premium-feature');

      await client.close();
    });

    it('should list basic tools for authenticated basic user', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer basic-token',
          },
        },
      });

      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name);

      // Should see public and basic protected tools
      expect(toolNames).toContain('public-search');
      expect(toolNames).toContain('smart-search');
      expect(toolNames).toContain('user-profile');

      // Should NOT see admin or premium tools
      expect(toolNames).not.toContain('admin-delete');
      expect(toolNames).not.toContain('system-config');
      expect(toolNames).not.toContain('premium-feature');

      await client.close();
    });

    it('should list all tools for admin user', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer admin-token',
          },
        },
      });

      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name);

      // Should see all tools
      expect(toolNames).toContain('public-search');
      expect(toolNames).toContain('smart-search');
      expect(toolNames).toContain('user-profile');
      expect(toolNames).toContain('admin-delete');
      expect(toolNames).toContain('system-config');

      // Admin doesn't have premium scope, so shouldn't see premium-feature
      expect(toolNames).not.toContain('premium-feature');

      await client.close();
    });

    it('should list premium tools for premium user', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer premium-token',
          },
        },
      });

      const tools = await client.listTools();
      const toolNames = tools.tools.map((t) => t.name);

      // Should see public, basic, and premium tools
      expect(toolNames).toContain('public-search');
      expect(toolNames).toContain('smart-search');
      expect(toolNames).toContain('user-profile');
      expect(toolNames).toContain('premium-feature');

      // Should NOT see admin tools
      expect(toolNames).not.toContain('admin-delete');
      expect(toolNames).not.toContain('system-config');

      await client.close();
    });

    it('should include securitySchemes in tool listing', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer admin-token',
          },
        },
      });

      const tools = await client.listTools();

      // Find the public-search tool
      const publicTool = tools.tools.find((t) => t.name === 'public-search');
      expect(publicTool).toBeDefined();
      expect(publicTool?.securitySchemes).toEqual([{ type: 'noauth' }]);

      // Find the user-profile tool (requires auth, no specific scopes)
      const userProfileTool = tools.tools.find(
        (t) => t.name === 'user-profile',
      );
      expect(userProfileTool).toBeDefined();
      expect(userProfileTool?.securitySchemes).toEqual([{ type: 'oauth2' }]);

      // Find the admin-delete tool (requires specific scopes)
      const adminDeleteTool = tools.tools.find(
        (t) => t.name === 'admin-delete',
      );
      expect(adminDeleteTool).toBeDefined();
      expect(adminDeleteTool?.securitySchemes).toEqual([
        { type: 'oauth2', scopes: ['admin', 'write'] },
      ]);

      // Find the smart-search tool (both noauth and oauth2)
      const smartSearchTool = tools.tools.find(
        (t) => t.name === 'smart-search',
      );
      expect(smartSearchTool).toBeDefined();
      // Should have both noauth and oauth2 with premium scope
      expect(smartSearchTool?.securitySchemes).toContainEqual({
        type: 'noauth',
      });
      expect(smartSearchTool?.securitySchemes).toContainEqual({
        type: 'oauth2',
        scopes: ['premium'],
      });

      await client.close();
    });
  });

  describe('Tool Execution with Authorization', () => {
    it('should allow calling public tools without auth', async () => {
      const client = await createSseClient(testPort);

      const result = await client.callTool({
        name: 'public-search',
        arguments: {},
      });

      expect((result.content as any)[0].text).toBe('Public search results');

      await client.close();
    });

    it('should reject protected tool calls without auth', async () => {
      const client = await createSseClient(testPort);

      await expect(
        client.callTool({
          name: 'user-profile',
          arguments: {},
        }),
      ).rejects.toThrow();

      await client.close();
    });

    it('should allow calling protected tools with valid auth', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer basic-token',
          },
        },
      });

      const result = await client.callTool({
        name: 'user-profile',
        arguments: {},
      });

      expect((result.content as any)[0].text).toContain('Profile for');

      await client.close();
    });

    it('should reject scope-protected tools without required scopes', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer basic-token', // Only has 'read' scope
          },
        },
      });

      await expect(
        client.callTool({
          name: 'admin-delete',
          arguments: {},
        }),
      ).rejects.toThrow();

      await client.close();
    });

    it('should allow scope-protected tools with required scopes', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer admin-token', // Has 'admin' and 'write' scopes
          },
        },
      });

      const result = await client.callTool({
        name: 'admin-delete',
        arguments: {},
      });

      expect((result.content as any)[0].text).toBe('User deleted');

      await client.close();
    });

    it('should reject role-protected tools without required roles', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer basic-token', // Only has 'user' role
          },
        },
      });

      await expect(
        client.callTool({
          name: 'system-config',
          arguments: {},
        }),
      ).rejects.toThrow();

      await client.close();
    });

    it('should allow role-protected tools with required roles', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer admin-token', // Has 'admin' role
          },
        },
      });

      const result = await client.callTool({
        name: 'system-config',
        arguments: {},
      });

      expect((result.content as any)[0].text).toBe('System configured');

      await client.close();
    });

    it('should support optional auth tools - anonymous access', async () => {
      const client = await createSseClient(testPort); // No auth

      const result = await client.callTool({
        name: 'smart-search',
        arguments: {},
      });

      expect((result.content as any)[0].text).toBe('Basic search results');

      await client.close();
    });

    it('should support optional auth tools - enhanced with auth', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer premium-token',
          },
        },
      });

      const result = await client.callTool({
        name: 'smart-search',
        arguments: {},
      });

      expect((result.content as any)[0].text).toBe(
        'AI-powered premium search results',
      );

      await client.close();
    });

    it('should allow premium-only tools for premium users', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer premium-token',
          },
        },
      });

      const result = await client.callTool({
        name: 'premium-feature',
        arguments: {},
      });

      expect((result.content as any)[0].text).toBe('Premium feature accessed');

      await client.close();
    });

    it('should reject premium-only tools for basic users', async () => {
      const client = await createSseClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer basic-token',
          },
        },
      });

      await expect(
        client.callTool({
          name: 'premium-feature',
          arguments: {},
        }),
      ).rejects.toThrow();

      await client.close();
    });
  });
});
