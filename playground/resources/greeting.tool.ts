import type { McpRequestWithUser } from '@rekog/mcp-nest';
import {
  McpContext,
  McpController,
  PublicTool,
  ToolRoles,
  ToolScopes,
  Tool,
} from '@rekog/mcp-nest';
import { Ctx, Payload } from '@nestjs/microservices';
import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

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

@McpController()
export class GreetingTool {
  constructor() {}

  @Tool({
    name: 'greet-logged-in-user',
    description:
      'Greets the currently logged-in user using their name from the request',
    annotations: {
      title: 'Greet Logged-in User Tool',
      destructiveHint: false,
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  async greetLoggedInUser(@Ctx() ctx: McpContext) {
    const request = ctx.getRawRequest<McpRequestWithUser>();
    // Try to extract user name from request (commonly request.user)
    let name;
    if (request?.user && typeof request.user === 'object') {
      name =
        request.user.displayName || request.user.username || request.user.name;
    }

    if (!name) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: No logged-in user found in the request.',
          },
        ],
      };
    }

    return `Hello, ${name}!`;
  }

  @Tool({
    name: 'greet-world',
    description: 'Returns a simple Hello, World! message',
  })
  greetWorld() {
    console.log('greet world called');
    return 'Hello, World!';
  }

  @Tool({
    name: 'public-greet-world',
    description: 'Returns a simple Hello, World! message',
    annotations: {
      title: 'Public Greet World Tool',
      destructiveHint: false,
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  @PublicTool()
  publicGreetWorld() {
    console.log('greet world called');
    return 'Public Hello, World!';
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
  async sayHello(
    @Payload() { name, language }: { name: string; language: string },
    @Ctx() context: McpContext,
  ) {
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
  async sayHelloElicitation(
    @Payload() { name }: { name: string },
    @Ctx() context: McpContext,
  ) {
    try {
      const res = context.mcpServer.server.getClientCapabilities();
      if (!res?.elicitation) {
        return {
          content: [
            {
              type: 'text',
              text: 'Elicitation is not supported by the client. Thus this tool cannot be used.',
            },
          ],
        };
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
        default:
          selectedLanguage = 'en';
      }

      const greetingWord =
        informalGreetings[selectedLanguage] || informalGreetings['en'];
      return { content: [{ type: 'text', text: `${greetingWord}, ${name}!` }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message}` }],
      };
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
    @Payload() { name, language }: { name: string; language: string },
  ) {
    if (!name || !language) {
      return {
        content: [
          {
            type: 'text',
            text: 'Error: Missing required parameters name and language.',
          },
        ],
      };
    }

    const greetingWord = informalGreetings[language] || informalGreetings['en'];
    const languageName = languageNames[language] || languageNames['en'];
    const greeting = `${greetingWord}, ${name}!`;

    const structuredContent = {
      greeting,
      language: language || 'en',
      languageName,
    };

    return {
      structuredContent,
      content: [
        {
          type: 'text',
          text: JSON.stringify(structuredContent, null, 2),
        },
      ],
    };
  }

  @Tool({
    name: 'greet-with-details',
    description: 'A tool to test input validation with required parameters',
    parameters: z.object({
      name: z.string().length(3, 'Name must be at least 3 characters long'),
      age: z.number().min(1).max(100),
    }),
  })
  async execute(@Payload() { name, age }: { name: string; age: number }) {
    return {
      content: [
        {
          type: 'text',
          text: `Received: ${name}, ${age} years old.`,
        },
      ],
    };
  }

  // Tool requiring specific scopes
  @Tool({
    name: 'admin-greet',
    description: 'Admin-only greeting that requires admin scopes',
    parameters: z.object({
      message: z.string().describe('Custom admin message'),
    }),
    annotations: {
      title: 'Admin Greeting Tool (Scopes Required)',
      destructiveHint: false,
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  @ToolScopes(['admin', 'write'])
  @ToolRoles(['admin'])
  async adminGreet(
    @Payload() { message }: { message: string },
    @Ctx() ctx: McpContext,
  ) {
    const request = ctx.getRawRequest<McpRequestWithUser>();
    const userName = request?.user?.name || request?.user?.username || 'Admin';
    return {
      content: [
        {
          type: 'text',
          text: `🔐 Admin Greeting: ${message} (from ${userName})`,
        },
      ],
    };
  }

  // Tool requiring specific roles
  @Tool({
    name: 'premium-greet',
    description: 'Premium greeting for users with premium role',
    parameters: z.object({
      name: z.string().describe('Name to greet'),
      level: z.enum(['gold', 'platinum']).describe('Premium level'),
    }),
    annotations: {
      title: 'Premium Greeting Tool (Roles Required)',
      destructiveHint: false,
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  @ToolRoles(['premium'])
  async premiumGreet(
    @Payload() { name, level }: { name: string; level: 'gold' | 'platinum' },
    @Ctx() ctx: McpContext,
  ) {
    const request = ctx.getRawRequest<McpRequestWithUser>();
    const userName =
      request?.user?.name || request?.user?.username || 'Premium User';
    const premiumEmojis = { gold: '🏆', platinum: '💎' };
    return {
      content: [
        {
          type: 'text',
          text: `${premiumEmojis[level]} Premium ${level} greeting: Hello ${name}! (from ${userName})`,
        },
      ],
    };
  }

  // Tool requiring both scopes AND roles
  @Tool({
    name: 'super-admin-greet',
    description:
      'Super admin greeting requiring both admin scopes AND super-admin role',
    parameters: z.object({
      target: z.string().describe('Target of the super admin greeting'),
      action: z.enum(['approve', 'deny', 'escalate']).describe('Admin action'),
    }),
    annotations: {
      title: 'Super Admin Greeting Tool (Scopes + Roles Required)',
      destructiveHint: false,
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  })
  @ToolScopes(['admin', 'write', 'delete'])
  @ToolRoles(['super-admin'])
  async superAdminGreet(
    @Payload()
    { target, action }: {
      target: string;
      action: 'approve' | 'deny' | 'escalate';
    },
    @Ctx() ctx: McpContext,
  ) {
    const request = ctx.getRawRequest<McpRequestWithUser>();
    const userName =
      request?.user?.name || request?.user?.username || 'Super Admin';
    const actionMessages = {
      approve: '✅ Approved',
      deny: '❌ Denied',
      escalate: '⚠️ Escalated',
    };
    return {
      content: [
        {
          type: 'text',
          text: `🔥 SUPER ADMIN: ${actionMessages[action]} ${target} by ${userName}`,
        },
      ],
    };
  }
}
