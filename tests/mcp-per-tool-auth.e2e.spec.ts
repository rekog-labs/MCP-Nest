import { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import { Ctx, Payload } from '@nestjs/microservices';
import {
  McpContext,
  McpController,
  Tool,
  PublicTool,
  ToolScopes,
  ToolRoles,
} from '../src';
import { bootstrapMcpApp, createStreamableClient } from './utils';

/**
 * Authentication is now Express middleware (replacing the old transport-level
 * guard). It allows unauthenticated requests through (calling `next()` without
 * a user) and enriches `req.user` when a recognised token is present. Per-tool
 * authorization (@PublicTool/@ToolScopes/@ToolRoles + freemium
 * allowUnauthenticatedAccess) is still enforced by the ToolAuthorizationService
 * reading the user off the raw request. Freemium mode is keyed off
 * `allowUnauthenticatedAccess` alone.
 */
const authMiddleware = (req: any, _res: any, next: () => void) => {
  const authHeader = req.headers?.authorization;

  if (!authHeader) {
    // Allow request through without user context.
    // Per-tool authorization will decide if this is OK.
    return next();
  }

  if (authHeader.includes('admin-token')) {
    req.user = {
      sub: 'admin123',
      name: 'Admin User',
      scope: 'admin write read', // Space-delimited as per OAuth 2.0 spec
      scopes: ['admin', 'write', 'read'], // Also as array for convenience
      roles: ['admin', 'user'],
    };
    return next();
  }

  if (authHeader.includes('basic-token')) {
    req.user = {
      sub: 'user123',
      name: 'Basic User',
      scope: 'read',
      scopes: ['read'],
      roles: ['user'],
    };
    return next();
  }

  if (authHeader.includes('premium-token')) {
    req.user = {
      sub: 'premium123',
      name: 'Premium User',
      scope: 'read premium',
      scopes: ['read', 'premium'],
      roles: ['user'],
    };
    return next();
  }

  // Unknown token — allow through with no user; per-tool auth will gate it.
  next();
};

@McpController()
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

  // Protected tool - requires authentication
  @Tool({
    name: 'user-profile',
    description: 'Get user profile',
  })
  async getUserProfile(@Payload() _args: unknown, @Ctx() ctx: McpContext) {
    const user = ctx.getRawRequest<{ user?: any }>()?.user;
    return {
      content: [
        {
          type: 'text',
          text: `Profile for ${user.name}`,
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
  async smartSearch(@Payload() _args: unknown, @Ctx() ctx: McpContext) {
    const user = ctx.getRawRequest<{ user?: any }>()?.user;
    if (user?.scopes?.includes('premium')) {
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
    const bootstrapped = await bootstrapMcpApp({
      name: 'test-per-tool-auth-server',
      controllers: [PerToolAuthTools],
      allowUnauthenticatedAccess: true, // Enable freemium mode for testing @PublicTool() tools
      configure: (nestApp) => {
        nestApp.use(authMiddleware);
      },
    });
    app = bootstrapped.app;
    testPort = bootstrapped.port;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Tool Listing with Authorization', () => {
    it('should list only public tools when not authenticated', async () => {
      const client = await createStreamableClient(testPort);

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
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort, {
        requestInit: {
          headers: {
            Authorization: 'Bearer admin-token',
          },
        },
      });

      const tools = await client.listTools();

      // Find the public-search tool
      const publicTool = tools.tools.find(
        (t) => t.name === 'public-search',
      ) as any;
      expect(publicTool).toBeDefined();
      // SDK strips unknown properties like securitySchemes
      // expect(publicTool?.securitySchemes).toEqual([{ type: 'noauth' }]);
      expect(publicTool?._meta?.securitySchemes).toEqual([{ type: 'noauth' }]);

      // Find the user-profile tool (requires auth, no specific scopes)
      const userProfileTool = tools.tools.find(
        (t) => t.name === 'user-profile',
      ) as any;
      expect(userProfileTool).toBeDefined();
      // expect(userProfileTool?.securitySchemes).toEqual([{ type: 'oauth2' }]);
      expect(userProfileTool?._meta?.securitySchemes).toEqual([
        { type: 'oauth2' },
      ]);

      // Find the admin-delete tool (requires specific scopes)
      const adminDeleteTool = tools.tools.find(
        (t) => t.name === 'admin-delete',
      ) as any;
      expect(adminDeleteTool).toBeDefined();
      // expect(adminDeleteTool?.securitySchemes).toEqual([
      //   { type: 'oauth2', scopes: ['admin', 'write'] },
      // ]);
      expect(adminDeleteTool?._meta?.securitySchemes).toEqual([
        { type: 'oauth2', scopes: ['admin', 'write'] },
      ]);

      // Find the smart-search tool (both noauth and oauth2)
      const smartSearchTool = tools.tools.find(
        (t) => t.name === 'smart-search',
      ) as any;
      expect(smartSearchTool).toBeDefined();
      // Should have both noauth and oauth2 with premium scope
      // expect(smartSearchTool?.securitySchemes).toContainEqual({
      //   type: 'noauth',
      // });
      // expect(smartSearchTool?.securitySchemes).toContainEqual({
      //   type: 'oauth2',
      //   scopes: ['premium'],
      // });
      expect(smartSearchTool?._meta?.securitySchemes).toContainEqual({
        type: 'noauth',
      });
      expect(smartSearchTool?._meta?.securitySchemes).toContainEqual({
        type: 'oauth2',
        scopes: ['premium'],
      });

      await client.close();
    });
  });

  describe('Tool Execution with Authorization', () => {
    it('should allow calling public tools without auth', async () => {
      const client = await createStreamableClient(testPort);

      const result = await client.callTool({
        name: 'public-search',
        arguments: {},
      });

      expect((result.content as any)[0].text).toBe('Public search results');

      await client.close();
    });

    it('should reject protected tool calls without auth', async () => {
      const client = await createStreamableClient(testPort);

      await expect(
        client.callTool({
          name: 'user-profile',
          arguments: {},
        }),
      ).rejects.toThrow();

      await client.close();
    });

    it('should allow calling protected tools with valid auth', async () => {
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort); // No auth

      const result = await client.callTool({
        name: 'smart-search',
        arguments: {},
      });

      expect((result.content as any)[0].text).toBe('Basic search results');

      await client.close();
    });

    it('should support optional auth tools - enhanced with auth', async () => {
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort, {
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
      const client = await createStreamableClient(testPort, {
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
