# Multi-Server Example Architecture

## Overview

This example runs two MCP servers in one NestJS app, each as a separate
`McpStrategy` mounted on its own HTTP endpoints. There is no `McpModule`: every
server is a NestJS microservices custom transport strategy.

## Server Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        NestJS Application                        │
│                                                                  │
│  ┌────────────────────────┐    ┌─────────────────────────────┐  │
│  │   publicStrategy       │    │    adminStrategy            │  │
│  │  (McpStrategy)         │    │   (McpStrategy)             │  │
│  ├────────────────────────┤    ├─────────────────────────────┤  │
│  │ Transports:            │    │ Transports:                 │  │
│  │ • StreamableHttp       │    │ • StreamableHttp            │  │
│  │     /public/mcp        │    │     /admin/mcp              │  │
│  └────────────────────────┘    └─────────────────────────────┘  │
│           │  connectMicroservice              │                  │
│           └────────────┬──────────────────────┘                 │
│                        │                                         │
│              ┌─────────▼─────────┐                              │
│              │   Feature Modules │ (@McpController + providers)  │
│              └─────────┬─────────┘                              │
└────────────────────────┼─────────────────────────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        │                │                │
        ▼                ▼                ▼
┌───────────────┐ ┌──────────────┐ ┌─────────────────┐
│ Weather       │ │ Analytics    │ │ Notification    │
│ Feature       │ │ Feature      │ │ Feature         │
│ Module        │ │ Module       │ │ Module          │
└───────────────┘ └──────────────┘ └─────────────────┘
```

## Tool Visibility (changed from the McpModule version)

NestJS binds a `@MessagePattern`/MCP handler to a strategy when the handler's
transport id matches the strategy's `transportId`. All `McpStrategy` instances
share the same MCP transport id, so **every `@McpController` in the app binds to
every connected strategy**. Both servers therefore expose the SAME tool set:

```
publicStrategy → get-weather, list-cities, get-metrics, track-request,
                 send-notification, get-notifications, mark-notification-read
adminStrategy  → (identical set)
```

The old `forFeature(tools, 'server-name')` mechanism that isolated tools per
server is gone. For genuinely distinct per-server tool sets, register tools
dynamically on the specific strategy instance instead (see
`../servers-with-dynamic-tools.ts`):

```typescript
publicStrategy.registerTool({ name: 'get-weather', /* ... */, handler });
adminStrategy.registerTool({ name: 'get-metrics', /* ... */, handler });
```

The endpoints remain fully isolated; only the advertised capability list is now
shared between strategies bound in the same app.

## Feature Module Pattern

Each feature module declares its capability class as a controller and its
dependency as a provider:

```typescript
@Module({
  controllers: [WeatherTools], // @McpController
  providers: [WeatherService], // plain provider dependency
  exports: [WeatherService],
})
export class WeatherFeatureModule {}
```

The capability class:

```typescript
@McpController()
export class WeatherTools {
  constructor(private readonly weatherService: WeatherService) {}

  @Tool({ name: 'get-weather', /* ... */ })
  async getWeather(@Payload() { city }: { city: string }) {
    /* ... */
  }
}
```

## Bootstrap Flow

```
main.ts
  app = NestFactory.create(AppModule)        // imports the 3 feature modules
  publicStrategy.setHttpAdapter(adapter)
  adminStrategy.setHttpAdapter(adapter)
  app.connectMicroservice({ strategy: publicStrategy })
  app.connectMicroservice({ strategy: adminStrategy })
  await app.startAllMicroservices()          // binds @McpControllers to BOTH strategies
  await app.listen(port)                      // transports mount their routes
```

## Request Pipeline

Because tools are real NestJS RPC handlers, a tool call flows through the full
pipeline:

```
Client → POST /public/mcp (callTool: get-weather)
      → StreamableHttpTransport (publicStrategy)
      → McpStrategy routes to the get-weather handler
      → NestJS RPC pipeline (guards/pipes/interceptors/filters)
      → WeatherTools.getWeather() → WeatherService.getWeather()
      → result
```

## Testing

Run the server:

```bash
npm run start:multi-server-example
```

Test the endpoints:

```bash
npx ts-node playground/servers/multi-server-example/test-tools.ts
```

Both `/public/*` and `/admin/*` advertise the same shared tool set.
```
✓ Public Server reachable, advertises the shared tool set
✓ Admin Server reachable, advertises the shared tool set
```
