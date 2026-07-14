import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

// A tiny, self-contained greeting capability so this example runs on its own —
// no shared `../../resources/*` classes. `@McpController()` marks the class as a
// source of MCP capabilities (RPC handlers), discovered and served through the
// guarded `/mcp` route.
const informalGreetings: Record<string, string> = {
  en: 'Hey',
  es: 'Qué tal',
  fr: 'Salut',
  de: 'Hi',
  it: 'Ciao',
  pt: 'Oi',
};

@McpController()
export class GreetingTool {
  @Tool({
    name: 'greet-world',
    description: 'Returns a simple Hello, World! message',
  })
  greetWorld() {
    return 'Hello, World!';
  }

  @Tool({
    name: 'greet-user',
    description: "Returns a personalized greeting in the user's language",
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      language: z
        .string()
        .optional()
        .describe('Language code (e.g. "en", "es", "fr", "de")'),
    }),
  })
  async greetUser(
    @Payload() { name, language }: { name: string; language?: string },
  ) {
    const word = informalGreetings[language ?? 'en'] ?? informalGreetings.en;
    return `${word}, ${name}!`;
  }
}
