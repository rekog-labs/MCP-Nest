import 'reflect-metadata';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DemoTools } from './demo.tools';
import { HttpLoggingMiddleware } from './http-layer';
import { McpHttpController } from './mcp-http.controller';
import { mcpStrategy } from './mcp.runtime';

@Module({
  controllers: [McpHttpController, DemoTools],
})
class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(HttpLoggingMiddleware).forRoutes(McpHttpController);
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = Number(process.env.PORT ?? 3000);

  mcpStrategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcpStrategy });
  await app.startAllMicroservices();
  await app.listen(port);

  console.log('');
  console.log('🧩 Two-layer pipeline MCP server is up');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   MCP endpoint:  http://localhost:${port}/mcp`);
  console.log('');
  console.log('   Watch the logs:');
  console.log('     [http-middleware] / [http-interceptor]  → every transport request');
  console.log('     [rpc-interceptor]                       → once per tool call (+ tags result)');
  console.log('     [rpc-filter]                            → when a tool throws (boom)');
  console.log('     [http-filter]                           → on a header-triggered HTTP failure');
  console.log('');
  console.log('   Drive it (second terminal):');
  console.log('     npm run call');
  console.log('');
  console.log('   Trigger the HTTP exception filter (raw request):');
  console.log(`     curl -s -XPOST http://localhost:${port}/mcp \\`);
  console.log("       -H 'content-type: application/json' -H 'x-demo-fail: http' \\");
  console.log('       -d \'{"jsonrpc":"2.0","id":1,"method":"ping"}\'');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

void bootstrap();
