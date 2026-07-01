import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { mcp, ServerModule } from './server.module';
import { ExternalModule } from './external.module';
import { StaticTools } from './static-tools.controller';
import { DynamicCapabilitiesService } from './dynamic-capabilities.service';
import { mcpServerA, mcpServerB, MultiServerModule } from './multi-server';

@Module({
  imports: [ServerModule, ExternalModule, MultiServerModule],
  controllers: [StaticTools],
  providers: [DynamicCapabilitiesService],
})
class AppModule {}

async function bootstrap() {
  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const app = await NestFactory.create(AppModule);
  mcp.setHttpAdapter(app.getHttpAdapter());
  mcpServerA.setHttpAdapter(app.getHttpAdapter());
  mcpServerB.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });
  app.connectMicroservice({ strategy: mcpServerA });
  app.connectMicroservice({ strategy: mcpServerB });
  await app.startAllMicroservices();
  await app.listen(port);
  console.log(`MCP server started on port ${port}`);
}
void bootstrap();
