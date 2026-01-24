# Registering Tools to MCP Servers

## Tool Discovery Overview

Tools are discovered automatically during application bootstrap via the `McpRegistryService`:

1. **Automatic discovery**: Tools in the module where `McpModule.forRoot()` is defined are discovered automatically.
2. **Manual registration**: Tools in other modules can be registered using `McpModule.forFeature()`.

## Automatic Discovery

When you define `McpModule.forRoot()` in a module, all `@Tool`, `@Resource`, `@ResourceTemplate`, and `@Prompt` decorated methods in that module's providers and controllers are automatically discovered.

```typescript
@Module({
  imports: [McpModule.forRoot({ name: 'my-server', version: '1.0.0' })],
  providers: [MyToolsService], // Tools discovered automatically
})
export class AppModule {}
```

## Manual Registration with forFeature()

Use `McpModule.forFeature()` to register tools from a separate module to a specific MCP server.

**Syntax:**
```typescript
McpModule.forFeature([ProviderClass, ...], 'server-name')
```

**Example:**

Feature module with tools:
```typescript
@Module({
  imports: [
    McpModule.forFeature([AnalyticsTools], 'admin-server'),
  ],
  providers: [AnalyticsTools, AnalyticsService],
  exports: [AnalyticsTools],
})
export class AnalyticsFeatureModule {}
```

Main module:
```typescript
@Module({
  imports: [
    McpModule.forRoot({ name: 'admin-server', version: '1.0.0' }),
    AnalyticsFeatureModule, // forFeature registration imported here
  ],
})
export class AppModule {}
```

**Key points:**
- The `server-name` must match the `name` in `McpModule.forRoot()`
- The provider class must be declared in the feature module's `providers` array
- Tool discovery happens at application bootstrap via reflection
- Multiple feature modules can register to the same or different MCP servers
- The same tool class can be registered to multiple servers by calling `forFeature()` separately
