import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class GreetingTool {
  @Tool({
    name: 'greet-user',
    description: 'Returns a personalized greeting',
    parameters: z.object({ name: z.string() }),
  })
  async sayHello(@Payload() { name }: { name: string }) {
    return `Hey, ${name}!`;
  }
}
