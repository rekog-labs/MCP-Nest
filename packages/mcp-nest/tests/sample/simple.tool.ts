import { Injectable } from '@nestjs/common';
import { Tool } from '../../src';

@Injectable()
export class SimpleTool {
  @Tool({
    name: 'simple-tool',
    description: 'A simple tool that gets the user by name',
  })
  async sayHello() {
    return {
      content: [
        {
          type: 'text',
          text: `Hello, from simple tool!`,
        },
      ],
    };
  }
}
