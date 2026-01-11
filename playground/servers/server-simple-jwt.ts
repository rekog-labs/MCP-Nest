import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import 'reflect-metadata';
import { McpModule } from '../../src';
import { GreetingPrompt } from '../resources/greeting.prompt';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingTool } from '../resources/greeting.tool';
import { SimpleJwtGuard } from './simple-jwt.guard';

dotenv.config();

@Module({
  imports: [
    McpModule.forRoot({
      name: 'playground-mcp-server-simple',
      version: '0.0.1',
      allowUnauthenticatedAccess: true,
      guards: [SimpleJwtGuard],
    }),
  ],
  providers: [GreetingResource, GreetingTool, GreetingPrompt, SimpleJwtGuard],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Enable cookie parser for session management
  app.use(cookieParser());

  // Enable CORS for development (configure properly for production)
  app.enableCors({
    origin: true,
    credentials: true,
  });
  await app.listen(3030);
  console.log('Simplified MCP JWT Server running on http://localhost:3030');
}
void bootstrap();
