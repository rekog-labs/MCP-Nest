#!/usr/bin/env node

import { Progress } from '@modelcontextprotocol/sdk/types.js';
import { Injectable, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';
import {
  MCP_STRATEGY,
  McpContext,
  McpController,
  McpStrategy,
  StreamableHttpTransport,
  Tool,
} from '@rekog/mcp-nest';

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

@McpController()
export class GreetingTool {
  constructor(private readonly userRepository: MockUserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that gets the user by name',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello(
    @Payload() { name }: { name: string },
    @Ctx() context: McpContext,
  ) {
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

const strategy = new McpStrategy({
  name: 'fastify-mcp-server',
  version: '0.0.1',
  transports: [new StreamableHttpTransport({ statefulMode: true })],
});

@Module({
  controllers: [GreetingTool],
  providers: [
    MockUserRepository,
    { provide: MCP_STRATEGY, useValue: strategy },
  ],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, new FastifyAdapter());
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });

  const port = 3030;
  console.log(`Starting MCP server (Fastify) on port ${port}`);
  console.log(`MCP endpoint available at: http://localhost:${port}/mcp`);

  await app.startAllMicroservices();
  await app.listen(port, '0.0.0.0');
  console.log(`MCP server is running on http://localhost:${port}`);
}

bootstrap().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
