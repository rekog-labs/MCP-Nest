# Dependency Injection in MCP Tools, Resources, and Prompts

With `@rekog/mcp-nest`, you can leverage all the power of NestJS's dependency injection system within your MCP tools, resources, and prompts. This means you can reuse existing services, repositories, database connections, HTTP clients, and any other business logic that you've already built in your NestJS application.

Because capability classes are `@McpController()` (registered in a module's `controllers` array) and tools/resources/prompts are real RPC handlers, dependency injection works exactly as it does in any NestJS controller. Plain services and repositories stay in `providers` and are injected through the constructor.

## Inject the Service into Your Tool

Inject your service into any MCP `@McpController()` class using standard NestJS constructor injection:

```typescript
import { McpController, Tool, McpContext } from '@rekog/mcp-nest';
import { Ctx, Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class GreetingTool {

  // Inject your existing service (registered in the module's `providers`)
  constructor(private readonly userRepository: UserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that gets the user by name',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello(@Payload() { name }: { name: string }, @Ctx() ctx: McpContext) {
    // Use your injected service
    const user = await this.userRepository.findByName(name);
    // ...
  }
}
```

> **NOTE:** for **Request-scoped services** use `@Injectable({ scope: Scope.REQUEST })` on the provider (or `@McpController({ scope: Scope.REQUEST })` on the capability class).

### Request-scoped behavior

In a request-scoped capability, `@Inject(REQUEST)` resolves to the **RPC request context**, not the raw HTTP request. To read HTTP headers, the authenticated user, etc., inject the raw request with `@McpRawRequest()`:

```typescript
async sayHello(@Payload() { name }: { name: string }, @McpRawRequest() req?: Request) {
  const user = req?.user; // Express/Fastify request (undefined for stdio)
  // ...
}
```

### Works With All MCP Types

- **Tools**: `@Tool()` decorated methods support full dependency injection
- **Resources**: `@Resource()` decorated methods work the same way
- **Prompts**: `@Prompt()` decorated methods also support injection
