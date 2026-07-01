import { McpController, Prompt, PromptResult } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class CodeReviewPrompt {
  @Prompt({
    name: 'code-review-guide',
    description: 'Instructions for reviewing code',
    parameters: z.object({
      codeLanguage: z.string(),
      focusArea: z.string(),
    }),
  })
  getCodeReviewPrompt(@Payload() { codeLanguage, focusArea }: { codeLanguage: string; focusArea: string }): PromptResult {
    return {
      description: 'Guide for conducting thorough code reviews',
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: `You are an expert ${codeLanguage} code reviewer.`,
          },
        },
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Please review this code focusing on: ${focusArea}`,
          },
        },
      ],
    };
  }
}
