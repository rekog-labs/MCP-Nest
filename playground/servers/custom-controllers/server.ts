import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import { GreetingPrompt } from '../../resources/greeting.prompt';
import { GreetingResource } from '../../resources/greeting.resource';
import { GreetingTool } from '../../resources/greeting.tool';

/**
 * Custom Endpoint Example
 *
 * The old "custom controllers" pattern (disabling transports and hand-writing a
 * controller around `McpStreamableHttpService`) is gone — transports now mount
 * their own routes on the Nest HTTP adapter. To customize the endpoint, just
 * configure the transport. Here we mount the Streamable HTTP transport on a
 * non-default `/mcp` route (set `endpoint` to whatever you need).
 */
const strategy = new McpStrategy({
  name: 'custom-controllers-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport({ endpoint: '/mcp' })],
});

@Module({
  controllers: [GreetingTool, GreetingResource, GreetingPrompt],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3030;

  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();

  await app.listen(port);
  console.log(`MCP server is running on http://localhost:${port}`);
  console.log('Available endpoints:');
  console.log('- POST /mcp - Streamable HTTP (main endpoint)');
  console.log('- GET /mcp - Streamable HTTP SSE stream');
  console.log('- DELETE /mcp - Streamable HTTP session termination');
}

void bootstrap();
