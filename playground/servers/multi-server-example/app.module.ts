import { Module } from '@nestjs/common';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import { WeatherModule } from './weather/weather.module';
import { TravelModule } from './travel/travel.module';

/**
 * Multi-Server Example Application
 *
 * A small travel-assistant app that exposes its DOMAINS as separate MCP servers
 * in one NestJS app — each domain is its own `McpStrategy` mounted on its own
 * HTTP endpoint, much like serving distinct API surfaces at different paths:
 *
 * - Weather server (`weather`): /weather/mcp
 * - Travel server  (`travel`):  /travel/mcp
 *
 * Splitting by domain (rather than, say, by audience/permissions) keeps each
 * server's tool surface small and focused: a client that only needs weather
 * connects to `/weather/mcp` and sees just the weather tools. Authentication is a
 * separate concern — layer guards/middleware on top if a given domain needs it.
 *
 * ## What changed vs. the old McpModule version
 *
 * `McpModule.forRoot` / `McpModule.forFeature` are gone. Each server is now a
 * `McpStrategy` connected via `app.connectMicroservice` (see `main.ts`). Tool
 * classes are `@McpController`s declared in a module's `controllers`; their
 * dependencies stay as `providers`.
 *
 * ## Per-domain isolation (named servers)
 *
 * Each strategy declares a `server` name, and each capability class is assigned
 * to a server with `@McpController({ server: '<name>' })`. NestJS then binds a
 * controller's tools ONLY to the strategy whose `server` matches, so every
 * server advertises just its OWN domain's tools:
 *
 * - `weather` → get-weather, list-cities
 * - `travel`  → recommend-destination, weather-at-destination
 *
 * ## Sharing logic across servers (one @Injectable() service, injected anywhere)
 *
 * The travel server reuses the weather server's `WeatherService`: its
 * `weather-at-destination` tool picks a destination (its own `TravelService`)
 * and then asks the SHARED `WeatherService` for the forecast. Sharing logic
 * across servers is just ordinary NestJS DI — export the service from its module
 * and inject it into the other server's controller (see `travel/travel.module.ts`).
 * No tool code is duplicated; only the thin `@Tool` declaration lives on each
 * server.
 *
 * ## Folder layout
 *
 * Each domain is a self-contained feature folder holding its service, its
 * `@McpController` tools, and its module:
 *
 *   weather/  → weather.service.ts, weather.tools.ts, weather.module.ts
 *   travel/   → travel.service.ts,  travel.tools.ts,  travel.module.ts (imports WeatherModule)
 */
export const weatherStrategy = new McpStrategy({
  name: 'weather',
  version: '1.0.0',
  server: 'weather',
  transports: [new StreamableHttpTransport({ endpoint: '/weather/mcp' })],
});

export const travelStrategy = new McpStrategy({
  name: 'travel',
  version: '1.0.0',
  server: 'travel',
  transports: [new StreamableHttpTransport({ endpoint: '/travel/mcp' })],
});

@Module({
  imports: [
    // Each feature module contributes one domain's @McpController capability
    // classes, assigned to that domain's server via @McpController({ server }).
    WeatherModule, // weather
    TravelModule, // travel (reuses WeatherService via DI)
  ],
})
export class AppModule {}
