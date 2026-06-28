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

// Stateless streamable-HTTP server: this is the default mode — every request is
// self-contained (no session id) and a plain POST gets a JSON reply, so there is
// nothing to configure. `new StreamableHttpTransport()` is stateless.
const strategy = new McpStrategy({
  name: 'playground-mcp-server',
  version: '0.0.1',
  transports: [new StreamableHttpTransport()],
});

@Module({
  controllers: [GreetingResource, GreetingTool, GreetingPrompt],
  providers: [{ provide: MCP_STRATEGY, useValue: strategy }],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  await app.listen(3030);

  console.log('MCP server started on port 3030');
}

void bootstrap();
