import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule } from '../../../src/mcp/mcp.module';
import { GreetingPrompt } from '../../resources/greeting.prompt';
import { GreetingResource } from '../../resources/greeting.resource';
import { GreetingTool } from '../../resources/greeting.tool';
import { SseController } from './sse.controller';
import { StreamableHttpController } from './streamable-http.controller';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'advanced-mcp-server',
      version: '1.0.0',
      transport: [], // Disable all default transports
    }),
  ],
  controllers: [SseController, StreamableHttpController],
  providers: [GreetingTool, GreetingResource, GreetingPrompt],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3030;

  await app.listen(port);
  console.log(`Advanced MCP server is running on http://localhost:${port}`);
  console.log('Available endpoints:');
  console.log('- GET /sse - SSE connection');
  console.log('- POST /messages - SSE message handling');
  console.log('- POST /mcp - Streamable HTTP (main endpoint)');
  console.log('- GET /mcp - Streamable HTTP SSE stream');
  console.log('- DELETE /mcp - Streamable HTTP session termination');
}

void bootstrap();
