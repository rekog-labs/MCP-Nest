import type { Request } from 'express';
import { Injectable } from '@nestjs/common';
import { Context, Tool } from '../../src';
import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

@Injectable()
export class GreetingTool {
  @Tool({
    name: 'hello-world',
    description:
      'Returns a greeting and simulates a long operation with progress updates',
    parameters: z.object({
      name: z.string().default('World'),
    }),
    outputSchema: z.object({
      content: z.array(
        z.object({
          type: z.literal('text'),
          text: z.string(),
        })
      ),
    }),
  })
  async sayHello({ name }, context: Context, request: Request) {
    const userAgent = request.get('user-agent') || 'Unknown';
    const greeting = `Hello, ${name}! Your user agent is: ${userAgent}`;
    const totalSteps = 5;
    for (let i = 0; i < totalSteps; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Send a progress update.
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return {
      content: [{ type: 'text', text: greeting }],
    };
  }
}
