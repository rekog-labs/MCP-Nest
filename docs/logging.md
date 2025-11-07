# Logging Configuration

This guide explains how to configure logging levels for your MCP server built with `@rekog/mcp-nest`.

## Overview

The MCP-Nest module uses NestJS's built-in `Logger` service for all internal logging. This means you can control the logging behavior using standard NestJS logger configuration.

By default, the module logs important events and discoveries:
- **LOG level**: Server initialization, route mapping, SSE ping service status
- **DEBUG level**: Tool/resource/prompt discovery, detailed operation traces
- **WARN level**: Warnings about misconfigurations or unsupported operations
- **ERROR level**: Error details and stack traces

## Configuring Log Levels

### Basic Configuration

You can control which log levels are output by configuring the logger when creating your NestJS application:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'], // Excludes 'debug' and 'verbose'
  });
  
  await app.listen(3000);
}

bootstrap();
```

### Common Logging Configurations

#### Production (Minimal Logging)
For production environments, you typically want only errors and warnings:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['error', 'warn'],
});
```

#### Development (Standard Logging)
For development, include informational logs but exclude debug:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['error', 'warn', 'log'],
});
```

#### Debugging (Verbose Logging)
When debugging issues, enable all log levels including debug:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['error', 'warn', 'log', 'debug', 'verbose'],
});
```

### Disabling Logs Completely

To disable all logging:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: false,
});
```

Or use an array with only the levels you want:

```typescript
const app = await NestFactory.create(AppModule, {
  logger: ['error'], // Only errors
});
```

## MCP Module Logging Behavior

### What Gets Logged at Each Level

#### DEBUG Level
Debug logs are used for detailed operational information:
- Tool, resource, and prompt discovery during bootstrap
- MCP session management (creation, deletion)
- SSE connection registration and removal
- Detailed request/response information

Example debug logs:
```
[Nest] DEBUG [McpRegistryService] Discovering tools, resources, resource templates, and prompts for module: AppModule
[Nest] DEBUG [McpRegistryService] Tool discovered: GreetingTool.sayHello in module: mcp-module-0
[Nest] DEBUG [McpStreamableHttpService] [session-123] Session initialized, storing references
```

#### LOG Level
Standard informational logs:
- Application startup
- Route mapping
- SSE ping service initialization
- Session cleanup

Example log messages:
```
[Nest] LOG [NestFactory] Starting Nest application...
[Nest] LOG [RouterExplorer] Mapped {/sse, GET} route
[Nest] LOG [SsePingService] Starting SSE ping service (interval: 30000ms)
```

#### WARN Level
Warnings about non-critical issues:
- Stateless context limitations
- Configuration issues

#### ERROR Level
Error messages with details:
- Failed operations
- Exception stack traces

## Environment-Based Configuration

You can use environment variables to control logging:

```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const logLevels = process.env.LOG_LEVEL?.split(',') || ['error', 'warn', 'log'];
  
  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });
  
  await app.listen(3000);
}

bootstrap();
```

Then set the environment variable:
```bash
# Development
LOG_LEVEL=error,warn,log,debug npm start

# Production
LOG_LEVEL=error,warn npm start
```

## Custom Logger

For more advanced logging needs, you can provide a custom logger implementation:

```typescript
import { LoggerService } from '@nestjs/common';

class CustomLogger implements LoggerService {
  log(message: string, context?: string) {
    // Your custom implementation
  }
  
  error(message: string, trace?: string, context?: string) {
    // Your custom implementation
  }
  
  warn(message: string, context?: string) {
    // Your custom implementation
  }
  
  debug(message: string, context?: string) {
    // Your custom implementation
  }
  
  verbose(message: string, context?: string) {
    // Your custom implementation
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new CustomLogger(),
  });
  
  await app.listen(3000);
}
```

## Filtering Logs by Context

If you want to filter logs from specific services, you can create a custom logger that checks the context:

```typescript
import { ConsoleLogger } from '@nestjs/common';

class FilteredLogger extends ConsoleLogger {
  private excludedContexts = ['McpRegistryService', 'SsePingService'];

  log(message: string, context?: string) {
    if (this.excludedContexts.includes(context)) return;
    super.log(message, context);
  }

  debug(message: string, context?: string) {
    if (this.excludedContexts.includes(context)) return;
    super.debug(message, context);
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: new FilteredLogger(),
  });
  
  await app.listen(3000);
}
```

## Testing with Different Log Levels

When writing tests, you might want to suppress logs:

```typescript
import { Test, TestingModule } from '@nestjs/testing';

describe('MyTest', () => {
  let app;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    // Suppress logs during tests
    app.useLogger(false);
    // Or specify minimal logging
    // app.useLogger(['error']);
    
    await app.init();
  });

  // ... tests
});
```

## Best Practices

1. **Production**: Use `['error', 'warn']` to keep logs minimal and focused on issues
2. **Development**: Use `['error', 'warn', 'log']` for general development work
3. **Debugging**: Enable `['error', 'warn', 'log', 'debug', 'verbose']` when troubleshooting
4. **CI/CD**: Consider using `['error']` in automated tests to reduce noise
5. **Use environment variables**: Make log levels configurable per environment
6. **Custom loggers**: For production systems, integrate with your logging infrastructure (Datadog, CloudWatch, etc.)

## Related Resources

- [NestJS Logger Documentation](https://docs.nestjs.com/techniques/logger)
- [Server Examples](./server-examples.md)
- [Tools Guide](./tools.md)
