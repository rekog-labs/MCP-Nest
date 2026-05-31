# Registering Tools to MCP Servers

## Tool Discovery Overview

There are two ways to expose capabilities on an `McpStrategy`:

1. **Automatic discovery (decorator-based)** — `@Tool`, `@Resource`, `@ResourceTemplate`, and `@Prompt` methods on `@McpController()` classes are discovered automatically. These run through the full NestJS RPC pipeline (guards, pipes, interceptors, exception filters).
2. **Dynamic registration (runtime)** — register capabilities programmatically on the strategy via `strategy.registerTool()` / `registerResource()` / `registerPrompt()`. See the [Dynamic Capabilities Guide](dynamic-capabilities.md). Dynamic handlers are invoked directly and bypass the RPC pipeline.

## Automatic Discovery

NestJS only scans classes in a module's `controllers` array for microservice
handlers. So capability classes must use `@McpController()` (which composes
`@Controller()`) and be listed in some module's `controllers` array. When the
strategy is connected via `app.connectMicroservice({ strategy })`, NestJS binds
every decorated handler into the strategy; on `startAllMicroservices()` the
strategy reads each handler's MCP metadata directly off the decorated method.

```typescript
import { Module } from '@nestjs/common';
import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class MyTools {
  @Tool({
    name: 'my-tool',
    description: 'A discovered tool',
    parameters: z.object({ input: z.string() }),
  })
  myTool(@Payload() { input }: { input: string }) {
    return { content: [{ type: 'text', text: input }] };
  }
}

@Module({
  controllers: [MyTools], // Tools discovered automatically
})
export class AppModule {}
```

There is **no `McpModule.forRoot()`** and **no `McpModule.forFeature()`** — the
strategy is the entire configuration, and discovery is driven purely by which
`@McpController` classes appear in a module's `controllers`.

## Grouping Tools via Feature Modules

To register tools defined in a separate module, declare them as `controllers`
in a feature module and import that module wherever the strategy's app module
lives. NestJS scans the `controllers` of every module in the graph, so any
`@McpController` reachable from the connected microservice is discovered.

**Feature module with tools:**

```typescript
@Module({
  controllers: [AnalyticsTools],
  providers: [AnalyticsService], // injected by AnalyticsTools
})
export class AnalyticsFeatureModule {}
```

**Main module:**

```typescript
@Module({
  imports: [AnalyticsFeatureModule], // its @McpController is discovered
  controllers: [CoreTools],
})
export class AppModule {}
```

**Key points:**

- Capability classes must be decorated with `@McpController()` and listed in a
  module's `controllers` array (directly or via an imported module).
- Any dependencies a controller injects must be available as `providers`.
- Discovery happens when the microservice is connected and started; there is no
  per-server name to match — all discovered `@McpController` handlers bind to
  the connected strategy.
- For multiple MCP servers in one app, construct one `McpStrategy` per server,
  connect each as a separate microservice, and partition the `@McpController`
  classes across the modules whose controllers each microservice scans.
