import { NestFactory } from '@nestjs/core';
import { AppModule, adminStrategy, publicStrategy } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Both strategies share the one HTTP adapter; each mounts its own transports
  // on its own distinct endpoints.
  const httpAdapter = app.getHttpAdapter();
  publicStrategy.setHttpAdapter(httpAdapter);
  adminStrategy.setHttpAdapter(httpAdapter);
  app.connectMicroservice({ strategy: publicStrategy });
  app.connectMicroservice({ strategy: adminStrategy });
  await app.startAllMicroservices();

  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log('');
  console.log('🚀 Multi-Server MCP Example started successfully!');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📡 PUBLIC SERVER (public-server)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   SSE Endpoint:        http://localhost:${port}/public/sse`);
  console.log(
    `   Messages Endpoint:   http://localhost:${port}/public/messages`,
  );
  console.log(`   MCP Endpoint:        http://localhost:${port}/public/mcp`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔐 ADMIN SERVER (admin-server)');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`   SSE Endpoint:        http://localhost:${port}/admin/sse`);
  console.log(
    `   Messages Endpoint:   http://localhost:${port}/admin/messages`,
  );
  console.log(`   MCP Endpoint:        http://localhost:${port}/admin/mcp`);
  console.log('');
  console.log('   Available Tools (shared across both servers):');
  console.log('   • get-weather            - Get current weather for a city');
  console.log('   • list-cities            - List all cities with weather data');
  console.log('   • get-metrics            - Get system metrics');
  console.log('   • track-request          - Track a request manually');
  console.log('   • send-notification      - Send a notification');
  console.log('   • get-notifications      - Get user notifications');
  console.log('   • mark-notification-read - Mark notification as read');
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log('💡 Example Usage with MCP Inspector:');
  console.log('');
  console.log('   npx @modelcontextprotocol/inspector \\');
  console.log(`     http://localhost:${port}/public/sse \\`);
  console.log(`     http://localhost:${port}/public/messages`);
  console.log('');
  console.log('   Or for the admin server:');
  console.log('');
  console.log('   npx @modelcontextprotocol/inspector \\');
  console.log(`     http://localhost:${port}/admin/sse \\`);
  console.log(`     http://localhost:${port}/admin/messages`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
}

void bootstrap();
