import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class GreetingTool {
  @Tool({
    name: 'greet-user',
    description: 'Returns a personalized greeting',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      language: z.string().describe('Language code (e.g., "en", "es", "fr")'),
    }),
  })
  async greet(@Payload() { name, language }: { name: string; language: string }) {
    const greetings: Record<string, string> = { en: 'Hey', es: 'Qué tal', fr: 'Salut' };
    const greeting = greetings[language] || greetings.en;
    return { content: [{ type: 'text', text: `${greeting}, ${name}!` }] };
  }
}
