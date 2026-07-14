import { McpController, McpRawRequest, Tool } from '@rekog/mcp-nest';
import type { McpRequestWithUser } from '@rekog/mcp-nest-auth';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class MyTools {
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
    name: 'whoami',
    description: 'Returns the authenticated user derived from the Bearer JWT',
  })
  whoami(@McpRawRequest() request?: McpRequestWithUser) {
    const user = request?.user as any;
    return {
      content: [
        { type: 'text', text: JSON.stringify(user ?? { user: null }, null, 2) },
      ],
    };
  }
}
