import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  MCP_STRATEGY,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { GreetingTool } from './greeting.tool';
import { ErrorTool } from './error.tool';
import { FilteredService } from './filters';

// Stateful so progress reporting and elicitation (session-aware) work.
// `capabilities: { logging: {} }` is required for ctx.log.* to actually reach
// the client — without it the server never advertises logging and the
// notifications/message frames are dropped (see the `log-demo` tool).
const mcp = new McpStrategy({
  name: 'try-docs-tools',
  version: '0.0.1',
  transports: [new StreamableHttpTransport({ statefulMode: true })],
  capabilities: { logging: {} },
});

@Module({
  controllers: [GreetingTool, ErrorTool, FilteredService],
  providers: [{ provide: MCP_STRATEGY, useValue: mcp }],
})
class AppModule {}

async function bootstrap() {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(port);
  console.log(`MCP server started on port ${port}`);
}

void bootstrap();
