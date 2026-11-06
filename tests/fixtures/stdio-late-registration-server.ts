import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';
import {
  McpController,
  McpStrategy,
  StdioTransport,
  Tool,
} from '@rekog/mcp-nest';

/**
 * A stdio server that starts with no resources and no prompts. Its one
 * decorated tool registers (or removes) a dynamic resource and prompt, so a
 * test can change the registry from inside the same long-lived connection.
 */
@McpController()
class LateRegistration {
  @Tool({
    name: 'toggle-late-entries',
    description: 'Registers or removes a dynamic resource and prompt',
    parameters: z.object({ present: z.boolean() }),
  })
  toggle(@Payload() { present }: { present: boolean }) {
    if (present) {
      strategy.registerResource({
        uri: 'mcp://late-resource',
        name: 'late-resource',
        handler: async () => ({
          contents: [{ uri: 'mcp://late-resource', text: 'late content' }],
        }),
      });
      strategy.registerPrompt({
        name: 'late-prompt',
        description: 'Registered after the connection opened',
        handler: async () => ({
          messages: [
            { role: 'user', content: { type: 'text', text: 'late prompt' } },
          ],
        }),
      });
    } else {
      strategy.removeResource('mcp://late-resource');
      strategy.removePrompt('late-prompt');
    }
    return { content: [{ type: 'text', text: 'ok' }] };
  }
}

// stdout is reserved for the MCP protocol over stdio, so all logging is disabled.
const strategy = new McpStrategy({
  name: 'stdio-late-registration-fixture',
  version: '0.0.1',
  logging: false,
  transports: [new StdioTransport()],
});

@Module({ controllers: [LateRegistration] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    strategy,
    logger: false,
  });
  await app.listen();
}

void bootstrap();
