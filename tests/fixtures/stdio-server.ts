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

@McpController()
class StdioGreeting {
  @Tool({
    name: 'hello',
    description: 'Greets the user',
    parameters: z.object({ name: z.string().default('World') }),
  })
  hello(@Payload() { name }: { name: string }) {
    return { content: [{ type: 'text', text: `Hello ${name}` }] };
  }
}

// stdout is reserved for the MCP protocol over stdio, so all logging is disabled.
const strategy = new McpStrategy({
  name: 'stdio-fixture',
  version: '0.0.1',
  logging: false,
  transports: [new StdioTransport()],
});

@Module({ controllers: [StdioGreeting] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    strategy,
    logger: false,
  });
  await app.listen();
}

void bootstrap();
