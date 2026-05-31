import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  MCP_STRATEGY,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { GreetingPrompt } from '../resources/greeting.prompt';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingTool } from '../resources/greeting.tool';

// `McpModule.forRootAsync` no longer exists — the strategy IS the configuration.
// To configure it from an async source (a ConfigService, a secrets fetch, etc.),
// simply `await` the value before constructing the McpStrategy and bootstrapping
// the app. Here we simulate that with a fake async config loader.
interface McpConfig {
  name: string;
  version: string;
}

async function loadConfigAsync(): Promise<McpConfig> {
  // Pretend this resolves from a ConfigService / remote source.
  await new Promise((resolve) => setTimeout(resolve, 10));
  return {
    name: process.env.MCP_NAME ?? 'playground-mcp-server-async',
    version: process.env.MCP_VERSION ?? '0.0.1',
  };
}

async function bootstrap() {
  // Async config resolution happens BEFORE the strategy is constructed.
  const config = await loadConfigAsync();

  const strategy = new McpStrategy({
    name: config.name,
    version: config.version,
    transports: [
      new StreamableHttpTransport({
        statelessMode: true,
        enableJsonResponse: true,
      }),
    ],
  });

  @Module({
    controllers: [GreetingResource, GreetingTool, GreetingPrompt],
    providers: [{ provide: MCP_STRATEGY, useValue: strategy }],
  })
  class AppModule {}

  const app = await NestFactory.create(AppModule);
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(3030);

  console.log(`MCP server (async config) started on port 3030 as "${config.name}"`);
}

void bootstrap();
