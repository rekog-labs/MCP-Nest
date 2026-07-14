import { McpController, Prompt } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import { UserRepository } from './user.repository';

@McpController()
export class GreetingPrompt {
  constructor(private readonly userRepository: UserRepository) {}

  @Prompt({
    name: 'greet-known-user',
    description:
      'Builds a greeting prompt using data from the injected UserRepository',
    parameters: z.object({
      name: z.string(),
    }),
  })
  async getGreetingPrompt(@Payload() { name }: { name: string }) {
    const user = await this.userRepository.findByName(name);
    return {
      description: 'Greet a known user',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: user
              ? `Greet ${user.name} whose email is ${user.email}`
              : `Greet an unknown user named ${name}`,
          },
        },
      ],
    };
  }
}
