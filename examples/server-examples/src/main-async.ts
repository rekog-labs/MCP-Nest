import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { MCP_STRATEGY, McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import { GreetingTool } from './greeting.tool';

async function loadConfig() {
  return { mcpName: 'async-mcp-server', mcpVersion: '0.0.1' };
}

async function bootstrap() {
  const config = await loadConfig();

  const mcp = new McpStrategy({
    name: config.mcpName ?? 'async-mcp-server',
    version: config.mcpVersion ?? '0.0.1',
    transports: [new StreamableHttpTransport()],
  });

  @Module({
    controllers: [GreetingTool],
    providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
  })
  class AppModule {}

  const port = process.env.PORT ? Number(process.env.PORT) : 3030;
  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(port);
  console.log(`MCP server started on port ${port}`);
}

void bootstrap();
