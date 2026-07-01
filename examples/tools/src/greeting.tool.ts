import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { McpController, Tool, McpContext, McpRawRequest } from '@rekog/mcp-nest';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';

// --- Guards (tools.md "Tool Guards") ---
@Injectable()
class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const ctx = context.switchToRpc().getContext<McpContext>();
    const request = ctx.getRawRequest();
    return (request as any)?.user?.role === 'admin';
  }
}

@Injectable()
class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const ctx = context.switchToRpc().getContext<McpContext>();
    const request = ctx.getRawRequest();
    return !!(request as any)?.user;
  }
}

@McpController()
export class GreetingTool {
  // --- Basic Tool ---
  @Tool({
    name: 'greet-user',
    description:
      "Returns a personalized greeting in the user's preferred language",
    parameters: z.object({
      name: z.string().describe('The name of the person to greet'),
      language: z.string().describe('Language code (e.g., "en", "es", "fr")'),
    }),
  })
  async sayHello(
    @Payload() { name, language }: { name: string; language: string },
    @Ctx() ctx: McpContext,
  ) {
    const greetings = { en: 'Hey', es: 'Qué tal', fr: 'Salut' };
    const greeting = greetings[language] || greetings.en;
    return `${greeting}, ${name}!`;
  }

  // --- Tool with Progress Reporting ---
  @Tool({
    name: 'process-data',
    description: 'Processes data with progress updates',
    parameters: z.object({ data: z.string() }),
  })
  async processData(
    @Payload() { data }: { data: string },
    @Ctx() ctx: McpContext,
  ) {
    const totalSteps = 5;
    for (let i = 0; i < totalSteps; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await ctx.reportProgress({ progress: (i + 1) * 20, total: 100 });
    }
    return `Processed: ${data}`;
  }

  // --- Tool with Output Schema ---
  @Tool({
    name: 'greet-user-structured',
    description: 'Returns a structured greeting with metadata',
    parameters: z.object({ name: z.string(), language: z.string() }),
    outputSchema: z.object({
      greeting: z.string(),
      language: z.string(),
      languageName: z.string(),
    }),
  })
  async sayHelloStructured(
    @Payload() { name, language }: { name: string; language: string },
  ) {
    return {
      greeting: `Hey, ${name}!`,
      language,
      languageName: 'English',
    };
  }

  // --- Interactive Tool with Elicitation ---
  @Tool({
    name: 'greet-user-interactive',
    description: 'Interactive greeting with language selection',
    parameters: z.object({ name: z.string() }),
  })
  async sayHelloInteractive(
    @Payload() { name }: { name: string },
    @Ctx() ctx: McpContext,
  ) {
    const response = await ctx.mcpServer.server.elicitInput({
      message: 'Please select your preferred language',
      requestedSchema: {
        type: 'object',
        properties: {
          language: {
            type: 'string',
            enum: ['en', 'es', 'fr', 'de'],
            description: 'Your preferred language',
          },
        },
      },
    });
    const selectedLanguage =
      response.action === 'accept' ? response.content.language : 'en';
    return `Hello, ${name}! (in ${selectedLanguage})`;
  }

  // --- @McpRawRequest() (tools.md method parameter #3) ---
  @Tool({
    name: 'whoami',
    description: 'Reads the user-agent header off the raw request',
    parameters: z.object({}),
  })
  async whoami(@Payload() _args: {}, @McpRawRequest() req?: any) {
    const ua = req?.headers?.['user-agent'] ?? 'unknown';
    return `user-agent: ${ua}`;
  }

  // --- Tool Guards ---
  @Tool({
    name: 'admin-action',
    description: 'Only executable by admins',
    parameters: z.object({ target: z.string() }),
  })
  @UseGuards(AdminGuard)
  async adminAction(@Payload() { target }: { target: string }) {
    return { content: [{ type: 'text', text: `Admin action on ${target}` }] };
  }

  @Tool({
    name: 'secure-action',
    description: 'Requires both authentication and admin role',
    parameters: z.object({}),
  })
  @UseGuards(AuthGuard, AdminGuard)
  async secureAction() {
    return { content: [{ type: 'text', text: 'Secure action complete' }] };
  }
}
