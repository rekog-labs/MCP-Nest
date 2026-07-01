import { McpController, Tool, McpContext } from '@rekog/mcp-nest';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { UserRepository } from './user.repository';

@McpController()
export class GreetingTool {
  constructor(private readonly userRepository: UserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that gets the user by name',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello(
    @Payload() { name }: { name: string },
    @Ctx() ctx: McpContext,
  ) {
    const user = await this.userRepository.findByName(name);
    return {
      content: [
        {
          type: 'text',
          text: user
            ? `Hello, ${user.name}! (${user.email})`
            : `No user found for "${name}"`,
        },
      ],
    };
  }
}
