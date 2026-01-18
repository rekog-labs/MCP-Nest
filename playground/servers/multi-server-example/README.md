# Multi-Server MCP Example

This example demonstrates the `McpModule.forFeature()` pattern for organizing MCP tools across multiple servers.

## Architecture

### Two MCP Servers
1. **Public Server** (`public-server`) - For general users
   - Weather tools
   - Notification tools (shared)

2. **Admin Server** (`admin-server`) - For administrators
   - Analytics tools
   - Notification tools (shared)

### Feature Modules

Each domain is organized into its own feature module with dependencies:

```
modules/
├── weather-feature.module.ts      → Registers WeatherTools to public-server
├── analytics-feature.module.ts    → Registers AnalyticsTools to admin-server
└── notification-feature.module.ts → Registers NotificationTools to BOTH servers (shared)

tools/
├── weather.tools.ts         → Depends on WeatherService
├── analytics.tools.ts       → Depends on AnalyticsService
└── notification.tools.ts    → Depends on NotificationService (SHARED TOOL)

services/
├── weather.service.ts
├── analytics.service.ts
└── notification.service.ts
```

## Key Features Demonstrated

### 1. Multiple Servers in One Application
Both `public-server` and `admin-server` run in the same NestJS app but are completely isolated.

### 2. Tool Organization with Dependencies
Each feature module encapsulates:
- Tool classes with `@Tool()` decorators
- Service dependencies
- `McpModule.forFeature()` registration

### 3. Shared Tools Across Servers
`NotificationTools` is registered to both servers via two `forFeature()` calls:

```typescript
@Module({
  imports: [
    McpModule.forFeature([NotificationTools], 'public-server'),
    McpModule.forFeature([NotificationTools], 'admin-server'),
  ],
  providers: [NotificationTools, NotificationService],
})
export class NotificationFeatureModule {}
```

## Running the Example

```bash
# From the project root
npm run start:multi-server-example

# Or with ts-node
npx ts-node playground/servers/multi-server-example/main.ts
```

## Testing with MCP Inspector

### Test the Public Server
```bash
npx @modelcontextprotocol/inspector \
  http://localhost:3000/public/sse \
  http://localhost:3000/public/messages
```

Try these tools:
- `get-weather` with `{ "city": "New York" }`
- `list-cities`
- `send-notification` with `{ "userId": "user1", "message": "Hello!" }`
- `get-notifications` with `{ "userId": "user1" }`

### Test the Admin Server
```bash
npx @modelcontextprotocol/inspector \
  http://localhost:3000/admin/sse \
  http://localhost:3000/admin/messages
```

Try these tools:
- `get-metrics`
- `track-request` with `{ "endpoint": "/api/test", "userId": "admin1" }`
- `send-notification` (same shared tool!)
- `get-notifications`

## Expected Behavior

### Public Server Tools
- ✅ `get-weather`
- ✅ `list-cities`
- ✅ `send-notification` (shared)
- ✅ `get-notifications` (shared)
- ✅ `mark-notification-read` (shared)

### Admin Server Tools
- ✅ `get-metrics`
- ✅ `track-request`
- ✅ `send-notification` (shared)
- ✅ `get-notifications` (shared)
- ✅ `mark-notification-read` (shared)

### Verification
1. Public server should NOT have `get-metrics` or `track-request`
2. Admin server should NOT have `get-weather` or `list-cities`
3. Both servers SHOULD have all notification tools
4. Each tool should work with its dependencies (services)

## File Structure

```
multi-server-example/
├── README.md                           # This file
├── main.ts                             # Application entry point
├── app.module.ts                       # Main module with server configurations
├── modules/
│   ├── weather-feature.module.ts       # Weather feature module
│   ├── analytics-feature.module.ts     # Analytics feature module
│   └── notification-feature.module.ts  # Notification feature module (shared)
├── tools/
│   ├── weather.tools.ts                # Weather tool definitions
│   ├── analytics.tools.ts              # Analytics tool definitions
│   └── notification.tools.ts           # Notification tool definitions (shared)
└── services/
    ├── weather.service.ts              # Weather business logic
    ├── analytics.service.ts            # Analytics business logic
    └── notification.service.ts         # Notification business logic (shared)
```

## How It Works

1. **Server Creation**: `McpModule.forRoot()` creates two isolated MCP servers with unique names
2. **Feature Registration**: `McpModule.forFeature([Tools], 'server-name')` associates tools with servers
3. **Dependency Injection**: NestJS handles all dependency injection automatically
4. **Discovery**: At bootstrap, the registry discovers all tools and maps them to their target servers

## Benefits of This Pattern

✅ **Modularity**: Each domain has its own module with clear boundaries
✅ **Reusability**: Shared tools can be registered to multiple servers
✅ **Dependency Management**: Services are properly injected and scoped
✅ **Scalability**: Easy to add new servers, tools, or features
✅ **Type Safety**: Full TypeScript support throughout
✅ **Testability**: Modules can be tested independently
