import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule, McpTransportType } from '../../src';
import { GreetingTool } from '../resources/greeting.tool';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingPrompt } from '../resources/greeting.prompt';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'playground-stdio-server',
      version: '0.0.1',
      transport: McpTransportType.STDIO,
    }),
  ],
  providers: [GreetingTool, GreetingPrompt, GreetingResource],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  return app.close();
}

void bootstrap();
