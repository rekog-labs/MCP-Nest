# Multi-Server MCP Example

This example demonstrates running **two isolated MCP servers in one NestJS app**,
each as its own `McpStrategy` mounted on distinct HTTP endpoints.

> **Migrated:** `McpModule.forRoot` and `McpModule.forFeature` are gone. Each
> server is now an `McpStrategy` connected via `app.connectMicroservice`. Tool
> classes are `@McpController`s declared in a module's `controllers`; their
> dependencies stay as `providers`.

## Architecture

### Two MCP Servers

1. **Public Server** (`public-server`) — endpoint `/public/mcp`
2. **Admin Server** (`admin-server`) — endpoint `/admin/mcp`

Each is a separate `McpStrategy` instance (defined in `app.module.ts`) connected
to the same Nest app in `main.ts`.

### Feature Modules

Each domain is organized into its own feature module:

```
modules/
├── weather-feature.module.ts      → controllers: [WeatherTools],      providers: [WeatherService]
├── analytics-feature.module.ts    → controllers: [AnalyticsTools],    providers: [AnalyticsService]
└── notification-feature.module.ts → controllers: [NotificationTools], providers: [NotificationService]

tools/        (now @McpController capability classes)
├── weather.tools.ts         → depends on WeatherService
├── analytics.tools.ts       → depends on AnalyticsService
└── notification.tools.ts    → depends on NotificationService

services/     (plain providers)
├── weather.service.ts
├── analytics.service.ts
└── notification.service.ts
```

## Important: tool visibility changed

With the strategy model, **every `@McpController` in the application binds to
every connected strategy** — all strategies share the same microservice transport
id. As a result, BOTH servers expose the SAME tool set. The old behavior where
`forFeature(tools, 'public-server')` gave each server its own distinct tool list
is no longer available through controllers.

If you need genuinely different tool sets per server, register them dynamically on
the specific strategy instance instead:

```typescript
publicStrategy.registerTool({ name: 'get-weather', /* ... */, handler });
adminStrategy.registerTool({ name: 'get-metrics', /* ... */, handler });
```

See [`../servers-with-dynamic-tools.ts`](../servers-with-dynamic-tools.ts) for the
dynamic-registration pattern. This example keeps the "multiple isolated servers on
distinct endpoints" intent; the endpoints are isolated even though the advertised
tools are shared.

## Running the Example

```bash
# From the project root
npm run start:multi-server-example

# Or with ts-node
npx ts-node playground/servers/multi-server-example/main.ts
```

## Testing with MCP Inspector

### Public Server

```bash
npx @modelcontextprotocol/inspector \
  http://localhost:3000/public/mcp
```

### Admin Server

```bash
npx @modelcontextprotocol/inspector \
  http://localhost:3000/admin/mcp
```

Both endpoints advertise the same shared tool set:

- `get-weather` with `{ "city": "New York" }`
- `list-cities`
- `get-metrics`
- `track-request` with `{ "endpoint": "/api/test", "userId": "admin1" }`
- `send-notification` with `{ "userId": "user1", "message": "Hello!" }`
- `get-notifications` with `{ "userId": "user1" }`
- `mark-notification-read` with `{ "notificationId": "..." }`

## File Structure

```
multi-server-example/
├── README.md                           # This file
├── ARCHITECTURE.md                     # Strategy/transport architecture
├── main.ts                             # Entry point: connect + start both strategies
├── app.module.ts                       # Strategy definitions + feature module imports
├── modules/
│   ├── weather-feature.module.ts
│   ├── analytics-feature.module.ts
│   └── notification-feature.module.ts
├── tools/                              # @McpController capability classes
│   ├── weather.tools.ts
│   ├── analytics.tools.ts
│   └── notification.tools.ts
└── services/                           # plain providers
    ├── weather.service.ts
    ├── analytics.service.ts
    └── notification.service.ts
```

## How It Works

1. **Strategy creation**: `new McpStrategy({ name, version, transports })` creates each server (`app.module.ts`).
2. **Capabilities**: `@McpController` classes in feature modules' `controllers` are bound to the connected strategies automatically.
3. **Connection**: `main.ts` calls `setHttpAdapter` + `connectMicroservice` for each strategy, then a single `startAllMicroservices()` and `listen()`.
4. **Dependency injection**: NestJS injects services into the controllers as usual; tools run through the full RPC pipeline (guards/pipes/interceptors/filters).
