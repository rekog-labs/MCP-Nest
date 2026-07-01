import { Inject, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { McpController, Tool, McpRawRequest } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { z } from 'zod';

@McpController({ scope: Scope.REQUEST })
export class RequestScopedTool {
  constructor(@Inject(REQUEST) private readonly injectedRequest: any) {}

  @Tool({
    name: 'inspect-request',
    description: 'Compares @Inject(REQUEST) with @McpRawRequest()',
    parameters: z.object({}),
  })
  async inspectRequest(@Payload() _args: {}, @McpRawRequest() rawReq?: any) {
    const ownProps = Object.keys(this.injectedRequest ?? {});
    const protoProps = Object.getOwnPropertyNames(
      Object.getPrototypeOf(this.injectedRequest ?? {}) ?? {},
    );
    const hasGetContext =
      typeof this.injectedRequest?.getContext === 'function';
    let rpcContextHasGetRawRequest = false;
    let rpcContextConstructorName: string | undefined;
    let rpcContextRawUserAgent: string | undefined;
    if (hasGetContext) {
      const rpcContext = this.injectedRequest.getContext();
      rpcContextHasGetRawRequest =
        typeof rpcContext?.getRawRequest === 'function';
      rpcContextConstructorName = rpcContext?.constructor?.name;
      rpcContextRawUserAgent = rpcContext?.getRawRequest?.()?.headers?.[
        'user-agent'
      ];
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            injectedRequestIsRpcContext:
              typeof this.injectedRequest?.getRawRequest === 'function',
            injectedRequestConstructorName:
              this.injectedRequest?.constructor?.name,
            injectedRequestHasGetContext: hasGetContext,
            viaGetContext_hasGetRawRequest: rpcContextHasGetRawRequest,
            viaGetContext_constructorName: rpcContextConstructorName,
            viaGetContext_userAgent: rpcContextRawUserAgent,
            rawRequestHasHeaders: typeof rawReq?.headers === 'object',
            rawRequestUserAgent: rawReq?.headers?.['user-agent'] ?? null,
            ownProps,
            protoProps,
          }),
        },
      ],
    };
  }
}
