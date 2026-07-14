import { McpController, Prompt } from '@rekog/mcp-nest';

@McpController()
export class GreetingPrompt {
  @Prompt({ name: 'greeting-guide', description: 'A guide for greeting users' })
  async getGuide() {
    return {
      description: 'A guide for greeting users',
      messages: [
        {
          role: 'assistant' as const,
          content: { type: 'text' as const, text: 'Always greet users warmly.' },
        },
      ],
    };
  }
}
