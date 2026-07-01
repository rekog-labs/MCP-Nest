import 'reflect-metadata';
import { Controller, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  MCP_STRATEGY,
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { MyTools } from './tools.controller';
import { AuthGuard, allowUnauthenticatedAccess } from './auth.guard';

// Shared transport instance so the guarded HTTP controller below binds to the
// SAME transport via `McpHttpControllerFor(mcpTransport)`. Referencing it here
// auto-disables the transport's own self-mount, so there is no double route.
const mcpTransport = new StreamableHttpTransport({ statefulMode: true });

const mcp = new McpStrategy({
  name: 'per-tool-authorization',
  version: '0.0.1',
  transports: [mcpTransport],
  allowUnauthenticatedAccess,
});

// The MCP endpoint as a real Nest controller, so `AuthGuard` runs on every
// transport request (including `tools/list`) and sets `req.user` before any
// per-tool authorization runs.
@Controller('mcp')
@UseGuards(AuthGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

@Module({
  controllers: [McpHttpController, MyTools],
  providers: [AuthGuard, { provide: MCP_STRATEGY, useValue: mcp }],
})
class AppModule {}

async function bootstrap() {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  await app.startAllMicroservices();
  await app.listen(port);
  console.log(
    `MCP server started on port ${port} (allowUnauthenticatedAccess=${allowUnauthenticatedAccess})`,
  );
}

void bootstrap();
