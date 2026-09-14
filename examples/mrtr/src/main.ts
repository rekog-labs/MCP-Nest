import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  MCP_STRATEGY,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { DeployTool } from './deploy.tool';
import { Vault } from './vault';
import { stateCodec } from './state';

const mcp = new McpStrategy({
  name: 'try-docs-mrtr',
  version: '0.0.1',
  // Stateful so 2025-era clients get a session: the SDK's legacy shim needs a
  // connection to push the converted server→client requests over. 2026-07-28
  // clients are sessionless either way.
  transports: [new StreamableHttpTransport({ statefulMode: true })],
  // Every echoed `requestState` is verified (and decoded) before a handler runs.
  requestState: { verify: stateCodec.verify },
  // Legacy shim: give up after 5 re-entries per originating request.
  inputRequired: { maxRounds: 5 },
});

@Module({
  controllers: [DeployTool, Vault],
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
  console.log(`MCP server started on http://localhost:${port}/mcp`);
}

void bootstrap();
