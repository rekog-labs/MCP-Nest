import { Controller, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { MyTools } from './my-tools';
import { SimpleJwtGuard, allowUnauthenticatedAccess } from './simple-jwt.guard';

// Pulled into a shared const so the guarded HTTP controller below can bind to
// the SAME transport instance via `McpHttpControllerFor(mcpTransport)`.
const mcpTransport = new StreamableHttpTransport();

const strategy = new McpStrategy({
  name: 'my-mcp-server',
  version: '1.0.0',
  transports: [mcpTransport],
  // Per-tool authorization reads `req.user` set by SimpleJwtGuard below.
  allowUnauthenticatedAccess,
});

// The MCP endpoint as a real Nest controller, so `SimpleJwtGuard` runs on every
// transport request (including `tools/list`). Referencing `mcpTransport` here
// auto-disables the transport's own self-mount, so there is no double route.
@Controller('mcp')
@UseGuards(SimpleJwtGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

@Module({
  controllers: [McpHttpController, MyTools],
  providers: [SimpleJwtGuard],
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  await app.startAllMicroservices();
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
  console.log(`started on port ${port}`);
}
void bootstrap();
