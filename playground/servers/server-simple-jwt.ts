import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import 'reflect-metadata';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import { GreetingPrompt } from '../resources/greeting.prompt';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingTool } from '../resources/greeting.tool';
import { createSimpleJwtMiddleware } from './simple-jwt.guard';

dotenv.config();

const allowUnauthenticatedAccess = true;

const strategy = new McpStrategy({
  name: 'playground-mcp-server-simple',
  version: '0.0.1',
  transports: [new StreamableHttpTransport({ statelessMode: false })],
  // Per-tool authorization reads `req.user` set by the JWT middleware below.
  allowUnauthenticatedAccess,
});

@Module({
  controllers: [GreetingResource, GreetingTool, GreetingPrompt],
  providers: [],
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

  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });

  // Authenticate MCP requests via Bearer JWT (replaces the old module guard).
  app.use(createSimpleJwtMiddleware({ allowUnauthenticatedAccess }));

  await app.startAllMicroservices();
  await app.listen(3030);
  console.log('Simplified MCP JWT Server running on http://localhost:3030');
}
void bootstrap();
