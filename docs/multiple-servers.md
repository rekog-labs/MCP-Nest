# Multiple MCP Servers in One App

A single NestJS app can expose **several independent MCP servers** — each on its
own endpoint, each advertising only its own tools/resources/prompts. This is the
strategy-API replacement for the old `McpModule.forFeature([...], 'server-name')`.

Use it when one process owns several distinct surfaces and you don't want every
client to see every tool — for example splitting by **domain** (a `weather`
server and a `travel` server) or by **audience** (a small `public` server and a
privileged `admin` server). Each server stays small and focused: a client that
connects to `/weather/mcp` sees only the weather tools.

> A complete, runnable version of everything below lives in
> [`examples/multiple-servers`](../examples/multiple-servers).
> Run it with `cd examples/multiple-servers && npm install && npm start`.

## How isolation works — named servers

Two pieces line up by a **server name**:

1. **The strategy** declares the name: `new McpStrategy({ server: 'weather', ... })`.
2. **The controller** declares the same name: `@McpController({ server: 'weather' })`.

NestJS then binds a controller's MCP handlers **only** to the strategy whose
`server` matches, so each server's `tools/list` returns just its own tools.
Under the hood each named server gets its own transport id, so the isolation is
handled by NestJS's normal microservice routing — there is no extra filtering
layer, and two servers can even expose a tool of the **same name** without
colliding (each call resolves to its own server's handler).

Omitting `server` on both sides keeps the **default shared server** — a plain
`@McpController()` binds to a plain `McpStrategy()`, exactly as a single-server
app works today. Named and unnamed servers can coexist in one app.

## Example: a `weather` server and a `travel` server

### 1. Business logic lives in `@Injectable()` services

Keep the real work in ordinary services. They're plain providers — nothing
MCP-specific — so they can be shared across servers via DI (see step 4).

```typescript
// weather/weather.service.ts
@Injectable()
export class WeatherService {
  private readonly data: Record<string, string> = {
    tokyo: 'cloudy, 18°C',
    london: 'rainy, 14°C',
  };
  getWeather(city: string): string {
    return this.data[city.toLowerCase()] ?? 'no data for that city';
  }
}
```

### 2. Each server's tools are a thin `@McpController({ server })`

The controller is a thin shell: it declares the `@Tool`s and delegates to the
service. Assigning it to `server: 'weather'` is what scopes it to the weather
server.

```typescript
// weather/weather.tools.ts
@McpController({ server: 'weather' })
export class WeatherTools {
  constructor(private readonly weatherService: WeatherService) {}

  @Tool({
    name: 'get-weather',
    description: 'Get current weather for a city',
    parameters: z.object({ city: z.string() }),
  })
  async getWeather(@Payload() { city }: { city: string }) {
    return {
      content: [{ type: 'text', text: `Weather in ${city}: ${this.weatherService.getWeather(city)}` }],
    };
  }
}
```

### 3. Group each feature in its own module

```typescript
// weather/weather.module.ts
@Module({
  controllers: [WeatherTools],
  providers: [WeatherService],
  exports: [WeatherService], // so other servers can reuse it
})
export class WeatherModule {}
```

### 4. Sharing logic across servers — just NestJS DI

To reuse logic on another server, **export the service** from its module and
**inject it** into the other server's controller. You re-declare a thin `@Tool`
on that server, but the logic itself is never duplicated.

Here the `travel` server reuses the weather server's `WeatherService`:

```typescript
// travel/travel.module.ts
@Module({
  imports: [WeatherModule], // brings in the exported WeatherService
  controllers: [TravelTools],
  providers: [TravelService],
})
export class TravelModule {}
```

```typescript
// travel/travel.tools.ts
@McpController({ server: 'travel' })
export class TravelTools {
  constructor(
    private readonly travelService: TravelService,
    private readonly weatherService: WeatherService, // the SAME instance the weather server uses
  ) {}

  @Tool({
    name: 'weather-at-destination',
    description: 'Recommend a destination for an interest and report its weather',
    parameters: z.object({ interest: z.string() }),
  })
  async weatherAtDestination(@Payload() { interest }: { interest: string }) {
    const city = this.travelService.recommend(interest);   // travel's own logic
    const weather = this.weatherService.getWeather(city);  // reused weather logic
    return {
      content: [{ type: 'text', text: `For ${interest}, visit ${city} — weather there: ${weather}.` }],
    };
  }
}
```

This is the idiomatic replacement for `forFeature`'s "register the same class on
several servers": **logic in a shared `@Injectable()`, a thin `@Tool` per
server**. A class is tagged for exactly one server, but the service behind it can
back as many servers as you like.

### 5. Create one strategy per server

```typescript
// app.module.ts
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
  imports: [WeatherModule, TravelModule],
})
export class AppModule {}
```

### 6. Connect and start every strategy

All strategies share the one HTTP adapter; each mounts its own endpoint. Connect
each as a microservice, then `startAllMicroservices()` **before** `listen()`.

```typescript
// main.ts
const app = await NestFactory.create(AppModule);

const httpAdapter = app.getHttpAdapter();
weatherStrategy.setHttpAdapter(httpAdapter);
travelStrategy.setHttpAdapter(httpAdapter);
app.connectMicroservice({ strategy: weatherStrategy });
app.connectMicroservice({ strategy: travelStrategy });

await app.startAllMicroservices(); // BEFORE listen()
await app.listen(3000);
```

Now `/weather/mcp` advertises `get-weather`, and `/travel/mcp` advertises
`weather-at-destination` — each server sees only its own domain.

## Dynamic registration is per-server too

`strategy.registerTool()` registers on that one strategy, so a runtime-registered
tool is visible only on that server. You can mix decorator tools and dynamic
tools per server. See [Dynamic Capabilities → Multi-Server Isolation](./dynamic-capabilities.md#multi-server-isolation).

## Things to know

- **A controller belongs to exactly one server.** You can't tag one decorated
  class for two servers — share via a service (step 4), not by reusing the class.
- **Watch for orphan controllers.** `@McpController({ server: 'x' })` with no
  connected `McpStrategy({ server: 'x' })` binds to nothing and its tools appear
  on no endpoint — silently. Make sure every server name you tag has a matching
  connected strategy.
- **Inherited methods aren't re-tagged.** A named `@McpController` only re-tags
  the MCP methods declared on the class itself, not ones inherited from a base
  class. Declare (or override) MCP methods on the controller you tag.
- **Authentication is a separate concern.** Named servers isolate *which tools*
  each endpoint exposes, not *who* may call them. Layer `@UseGuards()` per
  server as needed — see
  [Per-Tool Authorization](./per-tool-authorization.md) and the auth section of
  the [migration guide](./migration-to-strategy.md#6-authentication--authorization).

## See also

- [Migration to the Strategy API](./migration-to-strategy.md) — the `forFeature` → named-servers mapping.
- [Tool Discovery and Registration](./tool-discovery-and-registration.md) — how controllers are discovered.
- [Dynamic Capabilities](./dynamic-capabilities.md) — runtime registration, also per-server.
