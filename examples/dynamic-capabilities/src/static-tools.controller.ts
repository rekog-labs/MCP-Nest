import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class StaticTools {
  @Tool({
    name: 'static-tool',
    description: 'A statically defined tool',
    parameters: z.object({ input: z.string() }),
  })
  staticTool(@Payload() { input }: { input: string }) {
    return { content: [{ type: 'text', text: `Static: ${input}` }] };
  }
}
