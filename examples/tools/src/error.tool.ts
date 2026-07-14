import { McpController, Tool } from '@rekog/mcp-nest';
import { Payload, RpcException } from '@nestjs/microservices';
import { z } from 'zod';

// No filters — exercises the library's default RPC masking (tools.md behavioral note).
@McpController()
export class ErrorTool {
  @Tool({
    name: 'throw-plain',
    description: 'Throws a plain Error (should be masked)',
    parameters: z.object({}),
  })
  async throwPlain() {
    throw new Error('super secret internal detail');
  }

  @Tool({
    name: 'throw-rpc',
    description: 'Throws RpcException (should be surfaced unmasked)',
    parameters: z.object({}),
  })
  async throwRpc(@Payload() _a: {}) {
    throw new RpcException('actionable client-facing message');
  }
}
