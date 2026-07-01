import { McpController, Prompt } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class TaskPlannerPrompt {
  @Prompt({
    name: 'task-planner',
    description: 'Creates task planning prompts based on complexity',
    parameters: z.object({
      task: z.string(),
      complexity: z.enum(['simple', 'medium', 'complex']),
    }),
  })
  getTaskPlannerPrompt(@Payload() { task, complexity }: { task: string; complexity: 'simple' | 'medium' | 'complex' }) {
    const baseMessage = `Plan the following task: ${task}`;

    const complexityInstructions = {
      simple: 'Keep it straightforward with 2-3 steps.',
      medium: 'Break it down into clear phases with dependencies.',
      complex: 'Create a detailed plan with milestones, risks, and alternatives.',
    };

    return {
      description: `Task planning for ${complexity} task`,
      messages: [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: 'You are a project planning expert.',
          },
        },
        {
          role: 'user',
          content: {
            type: 'text',
            text: `${baseMessage}\n\n${complexityInstructions[complexity]}`,
          },
        },
      ],
    };
  }
}
