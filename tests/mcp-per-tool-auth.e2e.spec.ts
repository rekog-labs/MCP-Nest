import {
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  INestApplication,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Ctx, Payload } from '@nestjs/microservices';
import {
  McpContext,
  McpController,
  McpHttpControllerFor,
  StreamableHttpTransport,
  Tool,
  PublicTool,
  ToolScopes,
  ToolRoles,
} from '@rekog/mcp-nest';
import { bootstrapMcpApp, createStreamableClient } from './utils';

/**
 * Authentication is a NestJS guard on the MCP route. The guard reads the bearer token and
 * attaches `req.user`. Because this server runs in freemium mode
 * (`allowUnauthenticatedAccess: true`), the guard lets tokenless requests through
 * with no user; per-tool authorization (@PublicTool/@ToolScopes/@ToolRoles) then
 * decides what an anonymous or authenticated caller may see and call.
 */
const ALLOW_UNAUTHENTICATED_ACCESS = true;

function resolveUser(authHeader?: string): Record<string, unknown> | undefined {
  if (!authHeader) return undefined;

  if (authHeader.includes('admin-token')) {
    return {
      sub: 'admin123',
      name: 'Admin User',
      scope: 'admin write read', // Space-delimited as per OAuth 2.0 spec
      scopes: ['admin', 'write', 'read'], // Also as array for convenience
      roles: ['admin', 'user'],
    };
  }

  if (authHeader.includes('basic-token')) {
    return {
      sub: 'user123',
      name: 'Basic User',
      scope: 'read',
      scopes: ['read'],
      roles: ['user'],
    };
  }

  if (authHeader.includes('premium-token')) {
    return {
      sub: 'premium123',
      name: 'Premium User',
      scope: 'read premium',
      scopes: ['read', 'premium'],
      roles: ['user'],
    };
  }

  return undefined; // unknown token — treated as anonymous
}

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: unknown;
    }>();
    req.user = resolveUser(req.headers.authorization);

    // Standard mode would reject a tokenless request here; in freemium mode we
    // let it through and let per-tool authorization gate each tool.
    if (!req.user && !ALLOW_UNAUTHENTICATED_ACCESS) {
      throw new UnauthorizedException('Access token required');
    }
    return true;
  }
}

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

// Mount the MCP route as a real Nest controller so the guard runs at the HTTP
// layer on every transport request (initialize, tools/list, tools/call). Reading
// `transport.httpHandlers` inside McpHttpControllerFor auto-disables the
// transport's own self-mount.
const mcpTransport = new StreamableHttpTransport({ statefulMode: true });

@Controller('mcp')
@UseGuards(AuthGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

describe('E2E: Per-Tool Authorization', () => {
  let app: INestApplication;
  let testPort: number;

  beforeAll(async () => {
    const bootstrapped = await bootstrapMcpApp({
      name: 'test-per-tool-auth-server',
      controllers: [PerToolAuthTools, McpHttpController],
      providers: [AuthGuard],
      transports: [mcpTransport],
      allowUnauthenticatedAccess: true, // Freemium mode for @PublicTool() tools
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
