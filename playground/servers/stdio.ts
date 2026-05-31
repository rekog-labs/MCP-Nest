import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpStrategy, StdioTransport } from '@rekog/mcp-nest';
import { GreetingTool } from '../resources/greeting.tool';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingPrompt } from '../resources/greeting.prompt';

// stdio-only server: stdout carries the JSON-RPC protocol, so logging is fully
// disabled (both on the strategy and the Nest logger). No HTTP adapter needed.
const strategy = new McpStrategy({
  name: 'playground-stdio-server',
  version: '0.0.1',
  transports: [new StdioTransport()],
  logging: false,
});

@Module({
  controllers: [GreetingTool, GreetingPrompt, GreetingResource],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    strategy,
    logger: false,
  });
  await app.listen();
}

void bootstrap();
