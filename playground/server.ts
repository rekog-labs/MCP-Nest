import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { McpModule, McpTransportType } from '../src';
import { GreetingPrompt } from './greeting.prompt';
import { GreetingResource } from './greeting.resource';
import { GreetingTool } from './greeting.tool';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'playground-mcp-server',
      version: '0.0.1',
      streamableHttp: {
        enableJsonResponse: true,
        sessionIdGenerator: () => randomUUID(),
      },
      transport: McpTransportType.BOTH,
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
