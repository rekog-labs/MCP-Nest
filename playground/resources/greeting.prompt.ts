import { Injectable, Scope } from '@nestjs/common';
import { Prompt } from '../../src';
import { z } from 'zod';

@Injectable({ scope: Scope.REQUEST })
export class GreetingPrompt {
  constructor() {}

  @Prompt({
    name: 'hello-world',
    description: 'A simple greeting prompt',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      age: z.string().describe('The age of the person to greet'),
    }),
  })
  sayHello({ name, age }) {
    return {
      description: 'A simple greeting prompt',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Hello ${name}, you are ${age} years old`,
          },
        },
      ],
    };
  }
}
