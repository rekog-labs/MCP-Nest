import { McpController, Tool } from '@rekog/mcp-nest';
import { McpUser, McpUserPayload } from '@rekog/mcp-nest-auth';

@McpController()
export class GreetingTool {
  @Tool({ name: 'whoami', description: 'Return the authenticated user' })
  whoami(@McpUser() user?: McpUserPayload) {
    return {
      content: [
        { type: 'text', text: `Hello, ${user?.displayName ?? 'anonymous'}!` },
      ],
    };
  }
}
