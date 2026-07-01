import { McpController, Prompt } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class GreetingPrompt {
  @Prompt({
    name: 'multilingual-greeting-guide',
    description: 'Simple instruction for greeting users in their native languages',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      language: z.string().describe('The language to use for the greeting'),
    }),
  })
  getGreetingInstructions(@Payload() { name, language }: { name: string; language: string }) {
    return {
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
  }
}
