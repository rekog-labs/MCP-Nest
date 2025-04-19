import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule, McpTransportType } from '../src';
import { GreetingTool } from './greeting.tool';
import { GreetingResource } from './greeting.resource';
import { GreetingPrompt } from './greeting.prompt';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'playground-stdio-server',
      version: '0.0.1',
      transport: McpTransportType.STDIO,
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }),
  ],
  providers: [GreetingTool, GreetingPrompt, GreetingResource],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  return app.close();
}

void bootstrap();
