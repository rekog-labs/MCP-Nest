import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MCP_STRATEGY, McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import { GreetingTool } from './greeting.tool';
import { GreetingResource } from './greeting.resource';
import { GreetingPrompt } from './greeting.prompt';

const mcp = new McpStrategy({
  name: 'example-mcp-server',
  version: '0.0.1',
  transports: [new StreamableHttpTransport()],
});

@Module({
  controllers: [GreetingResource, GreetingTool, GreetingPrompt],
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
class AppModule {}

async function bootstrap() {
  const port = process.env.PORT ? Number(process.env.PORT) : 3030;
  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(port);
  console.log(`MCP server started on port ${port}`);
}

void bootstrap();
