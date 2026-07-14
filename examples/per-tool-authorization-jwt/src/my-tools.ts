import {
  McpController,
  McpRawRequest,
  PublicTool,
  ToolRoles,
  ToolScopes,
  Tool,
} from '@rekog/mcp-nest';
import type { McpRequestWithUser } from '@rekog/mcp-nest-auth';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class MyTools {
  @Tool({
    name: 'public-greet-world',
    description: 'Returns a simple Hello, World! message',
  })
  @PublicTool()
  publicGreetWorld() {
    return 'Public Hello, World!';
  }

  @Tool({
    name: 'greet-world',
    description: 'Returns a simple Hello, World! message',
  })
  greetWorld() {
    return 'Hello, World!';
  }

  @Tool({
    name: 'greet-user',
    description: 'Returns a personalized greeting',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
    }),
  })
  greetUser(@Payload() { name }: { name: string }) {
    return `Hello, ${name}!`;
  }

  @Tool({
    name: 'greet-logged-in-user',
    description:
      'Greets the currently logged-in user using their name from the request',
  })
  greetLoggedInUser(@McpRawRequest() request?: McpRequestWithUser) {
    const name =
      (request?.user as any)?.displayName ||
      (request?.user as any)?.username ||
      (request?.user as any)?.name;

    if (!name) {
      return {
        isError: true,
        content: [
          { type: 'text', text: 'Error: No logged-in user found in the request.' },
        ],
      };
    }

    return `Hello, ${name}!`;
  }

  @Tool({
    name: 'admin-greet',
    description: 'Admin-only greeting that requires admin scopes',
    parameters: z.object({
      message: z.string().describe('Custom admin message'),
    }),
  })
  @ToolScopes(['admin', 'write'])
  @ToolRoles(['admin'])
  adminGreet(
    @Payload() { message }: { message: string },
    @McpRawRequest() request?: McpRequestWithUser,
  ) {
    const userName = (request?.user as any)?.name ?? 'Admin';
    return { content: [{ type: 'text', text: `Admin Greeting: ${message} (from ${userName})` }] };
  }

  @Tool({
    name: 'premium-greet',
    description: 'Premium greeting for users with premium role',
    parameters: z.object({
      name: z.string().describe('Name to greet'),
      level: z.enum(['gold', 'platinum']).describe('Premium level'),
    }),
  })
  @ToolRoles(['premium'])
  premiumGreet(
    @Payload() { name, level }: { name: string; level: 'gold' | 'platinum' },
    @McpRawRequest() request?: McpRequestWithUser,
  ) {
    const userName = (request?.user as any)?.name ?? 'Premium User';
    return {
      content: [
        { type: 'text', text: `Premium ${level} greeting: Hello ${name}! (from ${userName})` },
      ],
    };
  }

  @Tool({
    name: 'super-admin-greet',
    description:
      'Super admin greeting requiring both admin scopes AND super-admin role',
    parameters: z.object({
      target: z.string().describe('Target of the super admin greeting'),
      action: z.enum(['approve', 'deny', 'escalate']).describe('Admin action'),
    }),
  })
  @ToolScopes(['admin', 'write', 'delete'])
  @ToolRoles(['super-admin'])
  superAdminGreet(
    @Payload()
    { target, action }: { target: string; action: 'approve' | 'deny' | 'escalate' },
    @McpRawRequest() request?: McpRequestWithUser,
  ) {
    const userName = (request?.user as any)?.name ?? 'Super Admin';
    return {
      content: [
        { type: 'text', text: `SUPER ADMIN: ${action} ${target} by ${userName}` },
      ],
    };
  }
}
