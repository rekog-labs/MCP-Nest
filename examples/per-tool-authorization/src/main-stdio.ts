import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpStrategy, StdioTransport } from '@rekog/mcp-nest';
import { MyTools } from './tools.controller';

const mcp = new McpStrategy({
  name: 'per-tool-authorization-stdio',
  version: '0.0.1',
  transports: [new StdioTransport()],
  logging: false,
});

@Module({
  controllers: [MyTools],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createMicroservice(AppModule, {
    strategy: mcp,
    logger: false,
  });
  await app.listen();
}

void bootstrap();
