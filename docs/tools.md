# Tools

Tools are functions that AI agents can execute to perform actions or computations. In mcp-nest, tools are defined using the `@Tool()` decorator on service methods.

This guide covers two primary ways to define tool parameters:
1. **`class-validator` (Recommended)**: The standard, idiomatic way in the NestJS ecosystem.
2. **`zod`**: A powerful alternative for schema-first development.

---

## Defining Parameters with `class-validator` (Recommended)

This is the recommended approach as it integrates seamlessly with NestJS's built-in validation and Swagger documentation pipelines.

### 1. Create a DTO

First, define a Data Transfer Object (DTO) class using `class-validator` for validation rules and `@nestjs/swagger`'s `@ApiProperty` for schema metadata.

```typescript
// greeting.dto.ts
import { IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GreetingDto {
  @ApiProperty({ description: 'The name of the person to greet' })
  @IsString()
  name: string;

  @ApiProperty({
    description: 'Language code (e.g., "en", "es", "fr")',
    enum: ['en', 'es', 'fr'],
  })
  @IsIn(['en', 'es', 'fr'])
  language: string;
}
```

### 2. Create the Tool

Use the DTO class as the `parameters` type in your `@Tool` decorator. The method argument will be an instance of your DTO class.

```typescript
// greeting.tool.ts
import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { GreetingDto } from './greeting.dto';

@Injectable()
export class GreetingTool {
  @Tool({
    name: 'greet-user',
    description: "Returns a personalized greeting in the user's preferred language",
    parameters: GreetingDto, // Use the DTO class here
  })
  async sayHello({ name, language }: GreetingDto, context: Context) {
    const greetings = {
      en: 'Hey',
      es: 'Qué tal',
      fr: 'Salut',
    };
    const greeting = greetings[language] || greetings.en;
    return `${greeting}, ${name}!`;
  }
}
```

### 3. Configure the Module

To use `class-validator`, you must explicitly provide the `ClassValidatorAdapter` when setting up the `McpModule`.

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { McpModule, ClassValidatorAdapter } from '@rekog/mcp-nest';
import { GreetingTool } from './greeting.tool';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'my-mcp-server',
      version: '1.0.0',
      validationAdapter: new ClassValidatorAdapter(), // Provide the adapter
    }),
  ],
  providers: [GreetingTool],
})
export class AppModule {}
```
**Note:** You also need to have `class-validator`, `class-transformer`, and `@nestjs/swagger` installed.

---

## Defining Parameters with `zod`

If you prefer Zod's schema-first approach, it works out-of-the-box without any extra configuration.

### 1. Create the Tool

Define a Zod schema and pass it to the `parameters` property in the `@Tool` decorator.

```typescript
import { Injectable } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { z } from 'zod';

const GreetingSchema = z.object({
  name: z.string().describe('The name of the person to greet'),
  language: z.enum(['en', 'es', 'fr']).describe('Language code'),
});

@Injectable()
export class GreetingToolWithZod {
  @Tool({
    name: 'greet-user-zod',
    description: "Returns a personalized greeting using a Zod schema",
    parameters: GreetingSchema, // Use the Zod schema here
  })
  async sayHello({ name, language }: z.infer<typeof GreetingSchema>) {
    // ... implementation ...
  }
}
```

### 2. Configure the Module

The `ZodValidationAdapter` is used by default, so no special configuration is needed.

```typescript
// app.module.ts
@Module({
  imports: [
    McpModule.forRoot({
      name: 'my-mcp-server',
      version: '1.0.0',
      // No validationAdapter needed, defaults to Zod
    }),
  ],
  providers: [GreetingToolWithZod],
})
export class AppModule {}
```

---

## Advanced Tool Features

### Understanding Tool Method Parameters

Every tool method receives exactly **three parameters** in this order:

1.  **`args`**: The validated input parameters, typed as your DTO class or inferred from your Zod schema.
2.  **`context: Context`**: The MCP execution context, providing access to `reportProgress()`, `mcpServer`, and more.
3.  **`request: Request`**: The original HTTP request object (Express/Fastify), which is `undefined` when using the STDIO transport.

### Tool with Progress Reporting

```typescript
@Tool({
  name: 'process-data',
  description: 'Processes data with progress updates',
  parameters: z.object({ data: z.string() }), // Zod or a DTO can be used
})
async processData({ data }, context: Context) {
  for (let i = 0; i <= 5; i++) {
    await new Promise(resolve => setTimeout(resolve, 100));
    await context.reportProgress({ progress: i * 20, total: 100 });
  }
  return `Processed: ${data}`;
}
```

### Tool with Output Schema

You can also use a DTO or a Zod schema for `outputSchema` to validate the tool's return value.

```typescript
// Using a DTO for the output
@Tool({
  name: 'greet-user-structured',
  description: 'Returns a structured greeting',
  parameters: GreetingDto,
  outputSchema: GreetingResultDto, // DTO class for the output
})
async sayHelloStructured({ name, language }: GreetingDto): Promise<GreetingResultDto> {
  // ...
  return { greeting: '...', language, languageName: '...' };
}
```

### Interactive Tool with Elicitation

Elicitation allows a tool to request more information from the user during its execution.

```typescript
@Tool({ name: 'interactive-tool', parameters: z.object({ name: z.string() }) })
async interactiveTool({ name }, context: Context) {
  const response = await context.mcpServer.server.elicitInput({
    message: 'Please provide your age.',
    requestedSchema: {
      type: 'object',
      properties: { age: { type: 'number' } },
    },
  });

  const age = response.action === 'accept' ? response.content.age : 'unknown';
  return `Hello, ${name}! Your age is ${age}.`;
}
```