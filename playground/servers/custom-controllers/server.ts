import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule } from '@rekog/mcp-nest';
import { GreetingPrompt } from '../../resources/greeting.prompt';
import { GreetingResource } from '../../resources/greeting.resource';
import { GreetingTool } from '../../resources/greeting.tool';
import { StreamableHttpController } from './streamable-http.controller';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'custom-controllers-server',
      version: '1.0.0',
      transport: [], // Disable all default transports
    }),
  ],
  controllers: [StreamableHttpController],
  providers: [GreetingTool, GreetingResource, GreetingPrompt],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3030;

  await app.listen(port);
  console.log(`MCP server is running on http://localhost:${port}`);
  console.log('Available endpoints:');
  console.log('- POST /mcp - Streamable HTTP (main endpoint)');
  console.log('- GET /mcp - Streamable HTTP SSE stream');
  console.log('- DELETE /mcp - Streamable HTTP session termination');
}

void bootstrap();
