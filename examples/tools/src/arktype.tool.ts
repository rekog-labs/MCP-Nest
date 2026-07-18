import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { type } from 'arktype';

@McpController()
export class ArkTypeTool {
  // Parameters AND outputSchema are ArkType types (a non-Zod Standard Schema,
  // carrying ~standard.jsonSchema + ~standard.validate). Proves mcp-nest now
  // drives non-Zod validators end-to-end.
  @Tool({
    name: 'arktype-add',
    description: 'Adds two numbers; input and output validated by ArkType.',
    parameters: type({ a: 'number', b: 'number' }),
    outputSchema: type({ sum: 'number' }),
  })
  async add(@Payload() { a, b }: { a: number; b: number }) {
    return { sum: a + b };
  }
}
