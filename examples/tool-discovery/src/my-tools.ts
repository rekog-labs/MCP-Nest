import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class MyTools {
  @Tool({
    name: 'my-tool',
    description: 'A discovered tool',
    parameters: z.object({ input: z.string() }),
  })
  myTool(@Payload() { input }: { input: string }) {
    return { content: [{ type: 'text', text: input }] };
  }
}
