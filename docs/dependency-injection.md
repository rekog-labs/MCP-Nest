# Dependency Injection in MCP Tools, Resources, and Prompts

With `@rekog/mcp-nest`, you can leverage all the power of NestJS's dependency injection system within your MCP tools, resources, and prompts. This means you can reuse existing services, repositories, database connections, HTTP clients, and any other business logic that you've already built in your NestJS application.

## Inject the Service into Your Tool

Inject your service into any MCP tool, resource, or prompt class using standard NestJS constructor injection:

```typescript
@Injectable()
export class GreetingTool {

  // Inject your existing service
  constructor(private readonly userRepository: UserRepository) {}

  @Tool({
    name: 'hello-world',
    description: 'A sample tool that gets the user by name',
    parameters: z.object({
      name: z.string().default('World'),
    }),
  })
  async sayHello({ name }, context: Context) {
    // Use your injected service
    const user = await this.userRepository.findByName(name);
    // ...
  }
}
```

> **NOTE:** for **Request-scoped services** use `@Injectable({ scope: Scope.REQUEST })` decorator for the class.

### Works With All MCP Types

- **Tools**: `@Tool()` decorated methods support full dependency injection
- **Resources**: `@Resource()` decorated methods work the same way
- **Prompts**: `@Prompt()` decorated methods also support injection
