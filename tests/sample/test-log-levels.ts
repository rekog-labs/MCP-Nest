import { Module, Injectable } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { McpModule, Tool } from '../../src';
import { z } from 'zod';

@Injectable()
class SimpleToolService {
  @Tool({
    name: 'simple-tool',
    description: 'A simple tool for testing',
    parameters: z.object({}),
  })
  async execute() {
    return {
      content: [{ type: 'text', text: 'Hello' }],
    };
  }
}

@Module({
  imports: [
    McpModule.forRoot({
      name: 'test-log-level-server',
      version: '0.0.1',
    }),
  ],
  providers: [SimpleToolService],
})
class AppModule {}

async function bootstrap() {
  // Test 1: Without debug logs (default behavior)
  console.log('\n=== Test 1: Logger without debug level ===');
  const app1 = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn'],
  });
  await app1.init();
  await app1.close();

  // Test 2: With debug logs enabled
  console.log('\n=== Test 2: Logger with debug level ===');
  const app2 = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug', 'verbose'],
  });
  await app2.init();
  await app2.close();

  console.log('\n=== Tests completed ===');
  process.exit(0);
}

void bootstrap();
