# Multi-Domain MCP Example

This is an example how to expose multiple MCP-Servers. It additionally shows how to share tools, by keeping the logic in services, and just duplicating the tool defintion.

## Running the Example

```bash
# From the project root
npm run start:multi-server
```

## Testing with MCP Inspector

### Weather Server

```bash
npx -y @modelcontextprotocol/inspector --cli http://localhost:3000/weather/mcp --transport http --method tools/list | jq '.tools[].name'

"get-weather"
"list-cities"
```

The **weather** endpoint advertises:

- `get-weather` with `{ "city": "Tokyo" }`
- `list-cities`

### Travel Server

```bash
npx -y @modelcontextprotocol/inspector --cli http://localhost:3000/travel/mcp --transport http --method tools/list | jq '.tools[].name'

"recommend-destination"
"weather-at-destination"
```

The **travel** endpoint advertises:

- `recommend-destination` with `{ "interest": "food" }`
- `weather-at-destination` with `{ "interest": "food" }` (reuses `WeatherService`)


## File Structure

```
multi-server-example/
├── README.md                   # This file
├── main.ts                     # Entry point: connect + start both strategies
├── app.module.ts               # Strategy definitions (named servers) + feature module imports
├── weather/                    # weather feature (self-contained)
│   ├── weather.service.ts      # SHARED @Injectable(), exported by WeatherModule
│   ├── weather.tools.ts        # @McpController({ server: 'weather' })
│   └── weather.module.ts
└── travel/                     # travel feature (self-contained)
    ├── travel.service.ts
    ├── travel.tools.ts         # @McpController({ server: 'travel' })
    └── travel.module.ts        # imports WeatherModule to reuse WeatherService
```

## How It Works

1. **Strategy creation**: `new McpStrategy({ name, version, server, transports })` creates each named domain server (`app.module.ts`).
2. **Capabilities**: `@McpController({ server })` classes bind ONLY to the strategy whose `server` matches.
3. **Connection**: `main.ts` calls `setHttpAdapter` + `connectMicroservice` for each strategy, then a single `startAllMicroservices()` and `listen()`.
4. **Shared logic**: `WeatherService` is a single instance, injected into both servers' controllers via DI; the travel server reuses it without duplicating any weather logic.
