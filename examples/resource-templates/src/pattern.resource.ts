import { McpController, ResourceTemplate } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';

@McpController()
export class PatternResource {
  @ResourceTemplate({
    name: 'account-single-param',
    description: 'Single parameter URI template',
    mimeType: 'application/json',
    uriTemplate: 'mcp://accounts/{userId}',
  })
  getAccount(@Payload() { uri, userId }: { uri: string; userId: string }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ userId }),
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'account-multi-param',
    description: 'Multiple parameters URI template',
    mimeType: 'application/json',
    uriTemplate: 'mcp://accounts/{userId}/posts/{postId}',
  })
  getAccountPost(
    @Payload()
    { uri, userId, postId }: { uri: string; userId: string; postId: string },
  ) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ userId, postId }),
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'docs-wildcard-param',
    description: 'Wildcard (catch-all) URI template',
    mimeType: 'application/json',
    uriTemplate: 'mcp://docs/{path*}',
  })
  getDoc(@Payload() { uri, path }: { uri: string; path: string }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ path }),
        },
      ],
    };
  }
}
