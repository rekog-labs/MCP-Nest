import type { Request } from 'express';
import { Injectable } from '@nestjs/common';
import { Context, Tool } from '../../src';
import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

@Injectable()
export class GreetingTool {
  constructor() {}

  @Tool({
    name: 'greet-world',
    description: 'Returns a simple Hello, World! message',
  })
  greetWorld() {
    console.log('greet world called');
    return 'Hello, World!';
  }

  @Tool({
    name: 'greet-user',
    description:
      "Returns a personalized greeting in the user's preferred language",
    parameters: z.object({
      name: z
        .string()
        .describe('The name of the person to greet')
        .nonempty('Name is required'),
      language: z
        .string()
        .describe('Language code (e.g., "en", "es", "fr", "de")')
        .nonempty('Language is required'),
    }),
    annotations: {
      title: 'Multi-language Greeting Tool',
      destructiveHint: false,
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async sayHello({ name, language }, context: Context, request: Request) {
    const informalGreetings = {
      en: 'Hey',
      es: 'Qué tal',
      fr: 'Salut',
      de: 'Hi',
      it: 'Ciao',
      pt: 'Oi',
      ja: 'やあ',
      ko: '안녕',
      zh: '嗨',
    };

    const greetingWord = informalGreetings[language] || informalGreetings['en'];
    const greeting = `${greetingWord}, ${name}!`;

    const totalSteps = 5;
    for (let i = 0; i < totalSteps; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    return greeting;
  }

  @Tool({
    name: 'greet-user-interactive',
    description:
      'Returns a personalized greeting with interactive language selection',
    parameters: z.object({
      name: z.string().describe('The first name of the person to greet'),
    }),
    annotations: {
      title: 'Interactive Greeting Tool',
      destructiveHint: false,
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async sayHelloElicitation({ name }, context: Context, request: Request) {
    try {
      const res = context.mcpServer.server.getClientCapabilities();
      if (!res?.elicitation) {
        const result = {
          content: [
            {
              type: 'text',
              text: 'Elicitation is not supported by the client. Thus this tool cannot be used.',
            },
          ],
        };
        return result;
      }

      const response = await context.mcpServer.server.elicitInput({
        message: 'Please select your preferred language',
        requestedSchema: {
          type: 'object',
          properties: {
            language: {
              type: 'string',
              enum: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'],
              description: 'Your preferred language for the greeting',
            },
          },
        },
      });

      let selectedLanguage = 'en';
      switch (response.action) {
        case 'accept': {
          selectedLanguage = (response?.content?.language as string) || 'en';
          break;
        }
        case 'decline':
        case 'cancel':
          selectedLanguage = 'en';
          break;
        default:
          selectedLanguage = 'en';
      }

      const informalGreetings = {
        en: 'Hey',
        es: 'Qué tal',
        fr: 'Salut',
        de: 'Hi',
        it: 'Ciao',
        pt: 'Oi',
        ja: 'やあ',
        ko: '안녕',
        zh: '嗨',
      };

      const greetingWord =
        informalGreetings[selectedLanguage] || informalGreetings['en'];
      const greeting = `${greetingWord}, ${name}!`;

      const result = {
        content: [{ type: 'text', text: greeting }],
      };

      return result;
    } catch (error) {
      const result = {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
      return result;
    }
  }

  @Tool({
    name: 'greet-user-structured',
    description: 'Returns a structured greeting message with language metadata',
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      language: z
        .string()
        .describe('Language code (e.g., "en", "es", "fr", "de")'),
    }),
    outputSchema: z.object({
      greeting: z.string(),
      language: z.string(),
      languageName: z.string(),
    }),
    annotations: {
      title: 'Structured Greeting Tool',
      destructiveHint: false,
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async sayHelloStructured(
    { name, language },
    context: Context,
    request: Request,
  ) {
    if (!name || !language) {
      console.log(
        '[greeting.tool.ts] Exiting sayHelloStructured (missing args)',
      );
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Missing required parameters name and language.',
          },
        ],
      };
    }

    const informalGreetings = {
      en: 'Hey',
      es: 'Qué tal',
      fr: 'Salut',
      de: 'Hi',
      it: 'Ciao',
      pt: 'Oi',
      ja: 'やあ',
      ko: '안녕',
      zh: '嗨',
    };

    const languageNames = {
      en: 'English',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      it: 'Italian',
      pt: 'Portuguese',
      ja: 'Japanese',
      ko: 'Korean',
      zh: 'Chinese',
    };

    const greetingWord = informalGreetings[language] || informalGreetings['en'];
    const languageName = languageNames[language] || languageNames['en'];
    const greeting = `${greetingWord}, ${name}!`;

    const totalSteps = 5;
    for (let i = 0; i < totalSteps; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }

    const structuredContent = {
      greeting,
      language: language || 'en',
      languageName,
    };

    const result = {
      structuredContent,
      content: [
        {
          type: 'text',
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
    };

    return result;
  }
}
