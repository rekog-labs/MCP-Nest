import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule, McpTransportType } from '@rekog/mcp-nest';
import { GreetingPrompt } from '../resources/greeting.prompt';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingTool } from '../resources/greeting.tool';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'playground-mcp-server',
      version: '0.0.1',
      transport: McpTransportType.STREAMABLE_HTTP,
      // already the default
      // streamableHttp: {
      //   enableJsonResponse: true,
      //   sessionIdGenerator: undefined,
      //   statelessMode: true,
      // },
    }),
  ],
  providers: [GreetingResource, GreetingTool, GreetingPrompt],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3030);

  console.log('MCP server started on port 3030');
}

void bootstrap();
