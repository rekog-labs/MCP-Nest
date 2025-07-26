import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';
import 'reflect-metadata';
import { GitHubOAuthProvider, McpAuthModule, McpModule } from '../../src';
import { JwtAuthGuard } from '../../src/authz/guards/jwt-auth.guard';
import { GoogleOAuthProvider } from '../../src/authz/providers/google.provider';
import { GreetingPrompt } from '../resources/greeting.prompt';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingTool } from '../resources/greeting.tool';

dotenv.config();

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      serverUrl: process.env.SERVER_URL,
      nodeEnv: process.env.NODE_ENV,
      apiPrefix: 'remote-auth',
      // endpoints: {
      //   wellKnown: '/.well-known/oauth-authorization-server',
      //   callback: '/remote-auth/auth/callback',
      // },
      // Storage Configuration - choose one of the following options:

      // Option 1: Use in-memory store (default if not specified)
      // storeConfiguration: { type: 'memory' }
      // OR just omit storeConfiguration entirely for memory store

      // Option 2: Use TypeORM for persistent storage
      // storeConfiguration: {
      //   type: 'typeorm',
      //   options: {
      //     type: 'sqlite',
      //     database: './oauth.db',
      //     synchronize: true,
      //     logging: false,
      //   },
      // },

      // Option 3: Use Drizzle for persistent storage
      // storeConfiguration: {
      //   type: 'custom',
      //   store: new SQLiteStore('./sqlite-store.db'),
      // },
    }),

    McpModule.forRoot({
      name: 'playground-mcp-server',
      version: '0.0.1',
      apiPrefix: 'remote-auth',
      streamableHttp: {
        enableJsonResponse: false,
        sessionIdGenerator: () => randomUUID(),
        statelessMode: false,
      },
      guards: [JwtAuthGuard],
    }),
  ],
  providers: [GreetingResource, GreetingTool, GreetingPrompt, JwtAuthGuard],
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
  console.log('MCP OAuth Server running on http://localhost:3030');
}
bootstrap();
