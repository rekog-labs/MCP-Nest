import {
  McpController,
  Tool,
  PublicTool,
  ToolScopes,
  ToolRoles,
  McpRawRequest,
} from '@rekog/mcp-nest';
import type { McpRequestWithUser } from '@rekog/mcp-nest-auth';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class MyTools {
  @Tool({
    name: 'public-greet-world',
    description: 'Public greeting, no authentication required',
  })
  @PublicTool()
  publicGreetWorld() {
    return { content: [{ type: 'text', text: 'Public Hello, World!' }] };
  }

  @Tool({
    name: 'greet-logged-in-user',
    description: 'Greets the currently logged-in user',
  })
  async greetLoggedInUser(@McpRawRequest() req?: McpRequestWithUser) {
    const user = req?.user;
    const name = user?.displayName || user?.username || user?.name;
    return {
      content: [{ type: 'text', text: `Hello, ${name ?? 'unknown'}!` }],
    };
  }

  @Tool({
    name: 'greet-world',
    description: 'Returns a simple Hello, World! (requires a logged-in user)',
  })
  greetWorld() {
    return { content: [{ type: 'text', text: 'Hello, World!' }] };
  }

  @Tool({
    name: 'greet-user',
    description: 'Personalized greeting (requires a logged-in user)',
    parameters: z.object({ name: z.string() }),
  })
  greetUser(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: `Hey, ${name}!` }] };
  }

  @Tool({
    name: 'admin-greet',
    description: 'Admin-only greeting (requires admin + write scopes)',
    parameters: z.object({ message: z.string() }),
  })
  @ToolScopes(['admin', 'write'])
  adminGreet(@Payload() { message }: { message: string }) {
    return { content: [{ type: 'text', text: `Admin says: ${message}` }] };
  }

  @Tool({
    name: 'premium-greet',
    description: 'Premium greeting (requires premium role)',
    parameters: z.object({ name: z.string() }),
  })
  @ToolRoles(['premium'])
  premiumGreet(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: `Premium hello, ${name}!` }] };
  }

  @Tool({
    name: 'super-admin-greet',
    description: 'Super-admin greeting (requires admin+write scopes AND super-admin role)',
    parameters: z.object({ target: z.string() }),
  })
  @ToolScopes(['admin', 'write'])
  @ToolRoles(['super-admin'])
  superAdminGreet(@Payload() { target }: { target: string }) {
    return { content: [{ type: 'text', text: `Super-admin acted on ${target}` }] };
  }
}
