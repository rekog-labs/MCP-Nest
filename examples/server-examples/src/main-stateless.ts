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
  // Optional server metadata advertised to clients on `initialize`.
  title: 'Example MCP Server',
  description: 'Greeting tools, resources, and prompts.',
  websiteUrl: 'https://example.com',
  instructions: 'Use greet-user for greetings. Prefer structured tools when available.',
  icons: [
    { src: 'https://example.com/icon.png', mimeType: 'image/png', sizes: ['48x48'] },
  ],
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
