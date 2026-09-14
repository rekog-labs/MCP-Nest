import { Ctx, Payload } from '@nestjs/microservices';
import {
  inputRequired,
  McpContext,
  McpController,
  Prompt,
  Resource,
} from '@rekog/mcp-nest';
import { z } from 'zod';

const PASSPHRASE = z.object({ passphrase: z.string() });
const TOPIC = z.object({ topic: z.string().min(1) });

/** MRTR is not tools-only: `resources/read` and `prompts/get` may ask too. */
@McpController()
export class Vault {
  @Resource({
    uri: 'mcp://vault',
    name: 'vault',
    description: 'Unlocks with a passphrase asked via elicitation',
    mimeType: 'text/plain',
  })
  async vault(@Payload() _args: unknown, @Ctx() ctx: McpContext) {
    const unlock = ctx.getAcceptedContent('unlock', PASSPHRASE);
    if (!unlock) {
      return inputRequired({
        inputRequests: {
          unlock: inputRequired.elicit({
            message: 'Passphrase for the vault?',
            requestedSchema: PASSPHRASE,
          }),
        },
      });
    }
    const ok = unlock.passphrase === 'open sesame';
    return {
      contents: [
        {
          uri: 'mcp://vault',
          mimeType: 'text/plain',
          text: ok ? 'The treasure is a well-tested MCP server.' : 'Wrong passphrase.',
        },
      ],
    };
  }

  @Prompt({ name: 'interview', description: 'Asks which topic to interview about' })
  async interview(@Payload() _args: unknown, @Ctx() ctx: McpContext) {
    const topic = ctx.getAcceptedContent('topic', TOPIC);
    if (!topic) {
      return inputRequired({
        inputRequests: {
          topic: inputRequired.elicit({
            message: 'Which topic should the interview cover?',
            requestedSchema: TOPIC,
          }),
        },
      });
    }
    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Interview me about ${topic.topic}. Ask one question at a time.`,
          },
        },
      ],
    };
  }
}
