import { Module } from '@nestjs/common';
import { McpModule } from '../../../src';
import { WeatherFeatureModule } from './modules/weather-feature.module';
import { AnalyticsFeatureModule } from './modules/analytics-feature.module';
import { NotificationFeatureModule } from './modules/notification-feature.module';

/**
 * Multi-Server Example Application
 *
 * This example demonstrates:
 * 1. Two MCP servers running in the same NestJS application
 * 2. Tools organized into feature modules with their dependencies
 * 3. A shared tool (notifications) registered to both servers
 *
 * Server Structure:
 * - Public Server (port 3000):
 *   - Weather tools (get-weather, list-cities)
 *   - Notification tools (send-notification, get-notifications, mark-notification-read)
 *   Endpoints: /public/mcp, /public/sse
 *
 * - Admin Server (port 3000):
 *   - Analytics tools (get-metrics, track-request)
 *   - Notification tools (send-notification, get-notifications, mark-notification-read)
 *   Endpoints: /admin/mcp, /admin/sse
 */

// Create the Public MCP Server
const publicServer = McpModule.forRoot({
  name: 'public-server',
  version: '1.0.0',
  mcpEndpoint: '/public/mcp',
  sseEndpoint: '/public/sse',
  messagesEndpoint: '/public/messages',
});

// Create the Admin MCP Server
const adminServer = McpModule.forRoot({
  name: 'admin-server',
  version: '1.0.0',
  mcpEndpoint: '/admin/mcp',
  sseEndpoint: '/admin/sse',
  messagesEndpoint: '/admin/messages',
});

@Module({
  imports: [
    // Import both MCP servers
    publicServer,
    adminServer,

    // Import feature modules
    // Each feature module uses McpModule.forFeature() to register its tools
    WeatherFeatureModule, // Registers to public-server
    AnalyticsFeatureModule, // Registers to admin-server
    NotificationFeatureModule, // Registers to BOTH servers (shared)
  ],
})
export class AppModule {}
