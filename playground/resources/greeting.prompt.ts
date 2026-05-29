import { Payload } from '@nestjs/microservices';
import { McpController, Prompt } from '@rekog/mcp-nest';
import { z } from 'zod';

@McpController()
export class GreetingPrompt {
  constructor() {}

  @Prompt({
    name: 'multilingual-greeting-guide',
    description:
      'Simple instruction for greeting users in their native languages',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      language: z.string().describe('The language to use for the greeting'),
    }),
  })
  getGreetingInstructions(
    @Payload() { name, language }: { name: string; language: string },
  ) {
    const result = {
      description: 'Greet users in their native languages!',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Greet ${name} in their preferred language: ${language}`,
          },
        },
      ],
    };
    return result;
  }
}
