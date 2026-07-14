import { McpController, McpRawRequest, Tool } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController()
export class MyTools {
  @Tool({
    name: 'whoami',
    description: 'Returns the authenticated user derived from the Bearer JWT.',
    parameters: z.object({}),
  })
  async whoami(@Payload() _args: unknown, @McpRawRequest() request: any) {
    const user = request?.user ?? {};
    return `sub=${user.sub ?? 'anonymous'} type=${user.type ?? 'n/a'}`;
  }
}
