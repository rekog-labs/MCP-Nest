import {
  McpController,
  Tool,
  PublicTool,
  ToolScopes,
  ToolRoles,
  McpRawRequest,
} from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class MyTools {
  // Public tool - accessible without authentication
  @Tool({
    name: 'public-search',
    description: 'Search publicly available data',
    parameters: z.object({
      query: z.string(),
    }),
  })
  @PublicTool()
  async publicSearch(@Payload() { query }: { query: string }) {
    return { content: [{ type: 'text', text: `Public search results for: ${query}` }] };
  }

  // Protected tool - requires an authenticated user (set by the auth guard)
  @Tool({
    name: 'user-profile',
    description: 'Get user profile',
  })
  async getUserProfile(
    @Payload() _args: unknown,
    @McpRawRequest() req?: { user?: any },
  ) {
    const user = req?.user;
    return { content: [{ type: 'text', text: `Profile for ${user.name}` }] };
  }

  // Requires specific OAuth scopes
  @Tool({
    name: 'admin-delete',
    description: 'Delete user (admin only)',
    parameters: z.object({
      userId: z.string(),
    }),
  })
  @ToolScopes(['admin', 'write'])
  async deleteUser(@Payload() { userId }: { userId: string }) {
    return { content: [{ type: 'text', text: `User ${userId} deleted` }] };
  }

  // Requires specific user roles
  @Tool({ name: 'system-config', description: 'Configure system settings' })
  @ToolRoles(['admin'])
  async configureSystem() {
    return { content: [{ type: 'text', text: 'System configured' }] };
  }
}
