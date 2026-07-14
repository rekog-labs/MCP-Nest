import { McpController, Prompt } from '@rekog/mcp-nest';
import { z } from 'zod';

const PIXEL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

@McpController()
export class ContentTypesPrompt {
  @Prompt({
    name: 'image-content-demo',
    description: 'Demonstrates the image content type for prompt messages',
    parameters: z.object({}),
  })
  getImageContentDemo() {
    return {
      description: 'Prompt message using image content',
      messages: [
        {
          role: 'user',
          content: {
            type: 'image',
            data: PIXEL_PNG_BASE64,
            mimeType: 'image/png',
          },
        },
      ],
    };
  }
}
