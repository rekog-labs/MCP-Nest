import { McpController, Prompt } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class InterviewPrompt {
  @Prompt({
    name: 'interview-guide',
    description: 'Structured interview questions',
    parameters: z.object({
      role: z.string().describe('Job role being interviewed for'),
      experience: z.string().describe('Years of experience'),
    }),
  })
  getInterviewGuide(@Payload() { role, experience }: { role: string; experience: string }) {
    return {
      description: `Interview guide for ${role} position`,
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: 'You are conducting a technical interview. Be thorough but encouraging.',
          },
        },
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: `Hello! I understand you're applying for a ${role} position with ${experience} years of experience.`,
          },
        },
        {
          role: 'user',
          content: {
            type: 'text',
            text: "Yes, that's correct. I'm excited to discuss the role.",
          },
        },
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: "Great! Let's start with some technical questions relevant to your experience level.",
          },
        },
      ],
    };
  }
}
