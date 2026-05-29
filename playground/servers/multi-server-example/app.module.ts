import { Module } from '@nestjs/common';
import {
  McpStrategy,
  SseTransport,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { WeatherFeatureModule } from './modules/weather-feature.module';
import { AnalyticsFeatureModule } from './modules/analytics-feature.module';
import { NotificationFeatureModule } from './modules/notification-feature.module';

/**
 * Multi-Server Example Application
 *
 * This example demonstrates two isolated MCP servers running in a single NestJS
 * application, each as its own `McpStrategy` mounted on distinct HTTP endpoints:
 *
 * - Public Server: /public/mcp, /public/sse
 * - Admin Server:  /admin/mcp,  /admin/sse
 *
 * ## What changed vs. the old McpModule version
 *
 * `McpModule.forRoot` / `McpModule.forFeature` are gone. Each server is now a
 * `McpStrategy` connected via `app.connectMicroservice` (see `main.ts`). Tool
 * classes are `@McpController`s declared in a module's `controllers`; their
 * dependencies stay as `providers`.
 *
 * IMPORTANT — tool visibility: every `@McpController` in the application binds to
 * EVERY connected strategy (all strategies share the same microservice transport
 * id), so both servers expose the SAME tool set. The old per-server registration
 * (`forFeature(tools, 'public-server')`) that gave each server a distinct tool
 * list is no longer available through controllers. If you need genuinely
 * different tool sets per server, register them dynamically on the specific
 * strategy instance instead — `strategy.registerTool({ ... })` (see
 * `../servers-with-dynamic-tools.ts`). This example keeps the "multiple isolated
 * servers on distinct endpoints" intent; the endpoints are isolated even though
 * the advertised tools are shared.
 */
export const publicStrategy = new McpStrategy({
  name: 'public-server',
  version: '1.0.0',
  transports: [
    new StreamableHttpTransport({ endpoint: '/public/mcp' }),
    new SseTransport({
      sseEndpoint: '/public/sse',
      messagesEndpoint: '/public/messages',
    }),
  ],
});

export const adminStrategy = new McpStrategy({
  name: 'admin-server',
  version: '1.0.0',
  transports: [
    new StreamableHttpTransport({ endpoint: '/admin/mcp' }),
    new SseTransport({
      sseEndpoint: '/admin/sse',
      messagesEndpoint: '/admin/messages',
    }),
  ],
});

@Module({
  imports: [
    // Feature modules contribute their @McpController capability classes.
    WeatherFeatureModule,
    AnalyticsFeatureModule,
    NotificationFeatureModule,
  ],
})
export class AppModule {}
