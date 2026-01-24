# Multi-Server Example Architecture

## Overview

This example demonstrates a production-ready pattern for organizing MCP tools using `McpModule.forFeature()`.

## Server Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NestJS Application                        │
│                                                                  │
│  ┌────────────────────────┐    ┌─────────────────────────────┐ │
│  │   Public MCP Server    │    │    Admin MCP Server         │ │
│  │  (public-server)       │    │   (admin-server)            │ │
│  ├────────────────────────┤    ├─────────────────────────────┤ │
│  │ Endpoints:             │    │ Endpoints:                  │ │
│  │ • /public/sse          │    │ • /admin/sse                │ │
│  │ • /public/messages     │    │ • /admin/messages           │ │
│  │ • /public/mcp          │    │ • /admin/mcp                │ │
│  └────────────────────────┘    └─────────────────────────────┘ │
│           │                                   │                  │
│           └────────────┬──────────────────────┘                 │
│                        │                                         │
│              ┌─────────▼─────────┐                              │
│              │   Feature Modules │                              │
│              └─────────┬─────────┘                              │
│                        │                                         │
└────────────────────────┼─────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌───────────────┐ ┌──────────────┐ ┌─────────────────┐
│ Weather       │ │ Analytics    │ │ Notification    │
│ Feature       │ │ Feature      │ │ Feature         │
│ Module        │ │ Module       │ │ Module (SHARED) │
└───────────────┘ └──────────────┘ └─────────────────┘
```

## Tool Distribution

### Public Server (`public-server`)
- **Weather Tools** (via WeatherFeatureModule)
  - `get-weather` - Get weather for a city
  - `list-cities` - List available cities

- **Notification Tools** (via NotificationFeatureModule) - SHARED
  - `send-notification` - Send a notification
  - `get-notifications` - Get user notifications
  - `mark-notification-read` - Mark notification as read

**Total: 5 tools**

### Admin Server (`admin-server`)
- **Analytics Tools** (via AnalyticsFeatureModule)
  - `get-metrics` - Get system metrics
  - `track-request` - Track a request manually

- **Notification Tools** (via NotificationFeatureModule) - SHARED
  - `send-notification` - Send a notification
  - `get-notifications` - Get user notifications
  - `mark-notification-read` - Mark notification as read

**Total: 5 tools**

## Feature Module Pattern

Each feature module follows this structure:

```typescript
@Module({
  imports: [
    // Register tools to specific server(s)
    McpModule.forFeature([ToolClass], 'server-name'),
  ],
  providers: [
    ToolClass,        // The tool provider
    ServiceClass,     // Dependencies
  ],
  exports: [ToolClass, ServiceClass],
})
export class FeatureModule {}
```

### Example: Weather Feature Module

```typescript
@Module({
  imports: [
    McpModule.forFeature([WeatherTools], 'public-server'),
  ],
  providers: [
    WeatherTools,      // Contains @Tool() decorated methods
    WeatherService,    // Business logic dependency
  ],
  exports: [WeatherTools, WeatherService],
})
export class WeatherFeatureModule {}
```

## Shared Tool Pattern

The `NotificationTools` is registered to BOTH servers:

```typescript
@Module({
  imports: [
    McpModule.forFeature([NotificationTools], 'public-server'),
    McpModule.forFeature([NotificationTools], 'admin-server'),
  ],
  providers: [NotificationTools, NotificationService],
  exports: [NotificationTools, NotificationService],
})
export class NotificationFeatureModule {}
```

This means:
- Same tool instance and service
- Shared state (notifications are visible from both servers)
- DRY principle - no code duplication

## Dependency Injection Flow

```
AppModule
    │
    ├─> McpModule.forRoot({ name: 'public-server', ... })
    │       └─> Creates public-server MCP instance
    │
    ├─> McpModule.forRoot({ name: 'admin-server', ... })
    │       └─> Creates admin-server MCP instance
    │
    ├─> WeatherFeatureModule
    │       ├─> Imports: McpModule.forFeature([WeatherTools], 'public-server')
    │       │       └─> Registers WeatherTools to public-server
    │       └─> Provides: WeatherTools, WeatherService
    │
    ├─> AnalyticsFeatureModule
    │       ├─> Imports: McpModule.forFeature([AnalyticsTools], 'admin-server')
    │       │       └─> Registers AnalyticsTools to admin-server
    │       └─> Provides: AnalyticsTools, AnalyticsService
    │
    └─> NotificationFeatureModule (SHARED)
            ├─> Imports:
            │   ├─> McpModule.forFeature([NotificationTools], 'public-server')
            │   │       └─> Registers NotificationTools to public-server
            │   └─> McpModule.forFeature([NotificationTools], 'admin-server')
            │           └─> Registers NotificationTools to admin-server
            └─> Provides: NotificationTools, NotificationService
```

## Discovery Process

At bootstrap, `McpRegistryService`:

1. **Builds server name map**: `'public-server' → mcp-module-0`, `'admin-server' → mcp-module-1`

2. **Collects feature registrations**:
   - WeatherTools → public-server
   - AnalyticsTools → admin-server
   - NotificationTools → public-server
   - NotificationTools → admin-server

3. **Discovers tools from providers**:
   - Finds provider instance
   - Scans methods for `@Tool()`, `@Resource()`, `@Prompt()` decorators
   - Registers each tool to its target server (by module ID)

4. **Result**: Each server has its own isolated tool registry

## Data Flow Example

### Weather Request
```
Client → GET /public/sse
      → Client connects and requests tools.list
      → McpSseService (public-server)
      → McpToolsHandler (module: mcp-module-0)
      → Returns: [get-weather, list-cities, send-notification, ...]

Client → POST /public/messages (callTool: get-weather)
      → McpSseService (public-server)
      → McpToolsHandler finds "get-weather" in mcp-module-0
      → McpExecutorService resolves WeatherTools instance
      → Calls WeatherTools.getWeather()
      → WeatherTools calls WeatherService.getWeather()
      → Returns weather data
```

### Analytics Request
```
Client → GET /admin/sse
      → Client connects and requests tools.list
      → McpSseService (admin-server)
      → McpToolsHandler (module: mcp-module-1)
      → Returns: [get-metrics, track-request, send-notification, ...]

Client → POST /admin/messages (callTool: get-metrics)
      → McpSseService (admin-server)
      → McpToolsHandler finds "get-metrics" in mcp-module-1
      → McpExecutorService resolves AnalyticsTools instance
      → Calls AnalyticsTools.getMetrics()
      → AnalyticsTools calls AnalyticsService.getMetrics()
      → Returns metrics data
```

## Benefits

### 1. Modularity
Each domain is self-contained with its dependencies

### 2. Scalability
Easy to add new servers or feature modules

### 3. Code Reuse
Shared tools registered to multiple servers without duplication

### 4. Type Safety
Full TypeScript support with dependency injection

### 5. Testability
Each module can be tested independently

### 6. Clear Ownership
Easy to see which tools belong to which server

## Testing

Run the server:
```bash
npm run start:multi-server
```

Test tool registration:
```bash
npx ts-node playground/servers/multi-server-example/test-tools.ts
```

Expected output:
```
✓ Public Server has 5 tools (2 weather + 3 notification)
✓ Admin Server has 5 tools (2 analytics + 3 notification)
✓ Public Server does NOT have analytics tools
✓ Admin Server does NOT have weather tools
✓ Both servers HAVE notification tools (shared)
```
