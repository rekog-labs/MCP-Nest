# Advanced: Custom Validation Adapters

The `@rekog/mcp-nest` module uses a flexible adapter-based system for handling parameter and output validation. This allows you to use your preferred validation library. We provide built-in adapters for **Zod** (the default) and **`class-validator`**, but you can easily create your own.

This guide will walk you through the process of creating a custom validation adapter for the `joi` library.

---

## The `IValidationAdapter` Interface

Any custom adapter must implement the `IValidationAdapter` interface. This ensures that the module can correctly validate data and generate JSON schemas for the capabilities document.

```typescript
// src/mcp/interfaces/validation-adapter.interface.ts

export interface IValidationAdapter {
  /**
   * Validates data against a schema.
   * @returns A promise that resolves to a success or error object.
   */
  validate(
    schema: any,
    data: any,
  ): Promise<{ success: true; data: any } | { success: false; error: any }>;

  /**
   * Converts a schema into a JSON Schema representation.
   * @returns A promise that resolves to the JSON Schema object.
   */
  toJsonSchema(schema: any): Promise<any>;
}
```

---

## Example: Creating a `JoiValidationAdapter`

Let's create an adapter for the popular `joi` validation library.

### 1. Install Dependencies

You'll need `joi` and a library to handle the conversion to JSON Schema, such as `joi-to-json-schema`.

```bash
npm install joi joi-to-json-schema
```

### 2. Implement the Adapter

Create a new class that implements `IValidationAdapter`.

```typescript
// joi-validation.adapter.ts
import { IValidationAdapter } from '@rekog/mcp-nest';
import * as Joi from 'joi';
import * as joiToJson from 'joi-to-json-schema';

export class JoiValidationAdapter implements IValidationAdapter {
  async validate(
    schema: Joi.Schema,
    data: any,
  ): Promise<{ success: true; data: any } | { success: false; error: any }> {
    const { error, value } = schema.validate(data, {
      abortEarly: false, // Report all errors
    });

    if (error) {
      return { success: false, error: error.details };
    }
    return { success: true, data: value };
  }

  async toJsonSchema(schema: Joi.Schema): Promise<any> {
    // The 'joi-to-json-schema' library converts a Joi schema to JSON Schema.
    // Most validation libraries have a similar community package available.
    const jsonSchema = joiToJson.convert(schema);
    return jsonSchema;
  }
}
```

### 3. Use the Custom Adapter

Now, simply pass an instance of your new adapter when you configure the `McpModule`.

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { MyToolProvider } from './my-tool.provider';
import { JoiValidationAdapter } from './joi-validation.adapter'; // Import your adapter

@Module({
  imports: [
    McpModule.forRoot({
      name: 'my-joi-server',
      version: '1.0.0',
      validationAdapter: new JoiValidationAdapter(), // Provide an instance
    }),
  ],
  providers: [MyToolProvider],
})
export class AppModule {}
```

### 4. Define a Tool with a Joi Schema

You can now use Joi schemas directly in your `@Tool` decorators.

```typescript
import { Injectable } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import * as Joi from 'joi';

const joiSchema = Joi.object({
  name: Joi.string().required().description('The name to greet'),
});

@Injectable()
export class MyToolProvider {
  @Tool({
    name: 'joi-tool',
    description: 'A tool validated with Joi',
    parameters: joiSchema,
  })
  myTool(args: { name: string }) {
    return `Hello from Joi, ${args.name}!`;
  }
}
```

By following this pattern, you can integrate any validation library of your choice into `@rekog/mcp-nest`.
