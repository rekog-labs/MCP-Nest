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

// stdout is reserved for the MCP protocol over stdio, so all logging is disabled.
const strategy = new McpStrategy({
  name: 'stdio-dynamic-fixture',
  version: '0.0.1',
  logging: false,
  transports: [new StdioTransport()],
});

/**
 * Lets a stdio client trigger runtime (un)registration from the other side of
 * the pipe, so a test can observe the resulting `list_changed` notification.
 */
@McpController()
class DynamicRegistry {
  @Tool({
    name: 'add-tool',
    description: 'Registers a tool at runtime',
    parameters: z.object({ name: z.string() }),
  })
  addTool(@Payload() { name }: { name: string }) {
    strategy.registerTool({
      name,
      description: 'Registered over stdio at runtime',
      handler: () => ({ content: [{ type: 'text', text: name }] }),
    });
    return { content: [{ type: 'text', text: `added ${name}` }] };
  }

  @Tool({
    name: 'remove-tool',
    description: 'Removes a runtime-registered tool',
    parameters: z.object({ name: z.string() }),
  })
  removeTool(@Payload() { name }: { name: string }) {
    strategy.removeTool(name);
    return { content: [{ type: 'text', text: `removed ${name}` }] };
  }
}

@Module({ controllers: [DynamicRegistry] })
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    strategy,
    logger: false,
  });
  await app.listen();
}

void bootstrap();
