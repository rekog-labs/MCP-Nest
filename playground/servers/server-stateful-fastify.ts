#!/usr/bin/env node

import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { z } from 'zod';
import { Context, Tool } from '@rekog/mcp-nest';
import { McpModule } from '@rekog/mcp-nest';

@Injectable()
class MockUserRepository {
  async findByName(name: string) {
    return Promise.resolve({
      id: 'user123',
      name: 'Repository User Name ' + name,
      orgMemberships: [
        {
          orgId: 'org123',
          organization: {
            name: 'Repository Org',
          },
        },
      ],
    });
  }
}

@Injectable()
export class GreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that gets the user by name',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }: { name: string }, context: Context) {
    const user = await this.userRepository.findByName(name);
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      await context.reportProgress({
        progress: (i + 1) * 20,
        total: 100,
      } as Progress);
    }
    return {
      content: [
        {
          type: 'text',
          text: `Hello, ${user.name}! (via Fastify)`,
        },
      ],
    };
  }
}

@Module({
  imports: [
    McpModule.forRoot({
      name: 'fastify-mcp-server',
      version: '0.0.1',
      streamableHttp: {
        statelessMode: false,
      },
    }),
  ],
  providers: [GreetingTool, MockUserRepository],
})
export class AppModule {}

async function bootstrap() {
  let app;
  let framework = 'Express (default)';

  try {
    // Try to use Fastify if available
    const fastifyPlatform = await import('@nestjs/platform-fastify');
    const adapter = new fastifyPlatform.FastifyAdapter();
    app = await NestFactory.create(AppModule, adapter);
    framework = 'Fastify';
  } catch (error) {
    // Fallback to Express if Fastify is not available
    console.warn(
      'Fastify not available, falling back to Express. Install @nestjs/platform-fastify to use Fastify.',
    );
    app = await NestFactory.create(AppModule);
    app.enableCors({
      origin: true,
      credentials: true,
    });
  }

  const port = 3030;
  console.log(`🚀 Starting MCP server on port ${port}`);
  console.log(`📡 MCP endpoint available at: http://localhost:${port}/mcp`);
  console.log(`🔧 Framework: ${framework}`);
  console.log('');
  console.log('To test with Fastify:');
  console.log('1. Install: npm install @nestjs/platform-fastify @fastify/cors');
  console.log('2. Restart the server');

  await app.listen(port, '0.0.0.0');
  console.log(`MCP server is running on http://localhost:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
