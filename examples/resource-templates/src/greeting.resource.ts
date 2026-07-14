import { McpController, ResourceTemplate } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';

@McpController()
export class GreetingResource {
  @ResourceTemplate({
    name: 'user-language',
    description: "Get a specific user's preferred language",
    mimeType: 'application/json',
    uriTemplate: 'mcp://users/{name}',
  })
  getUserLanguage(@Payload() { uri, name }: { uri: string; name: string }) {
    const users = {
      alice: 'en',
      carlos: 'es',
      marie: 'fr',
      hans: 'de',
      yuki: 'ja',
      'min-jun': 'ko',
      wei: 'zh',
      sofia: 'it',
      joão: 'pt',
    };

    const language = users[name.toLowerCase()] || 'en';

    return {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify({ name, language }, null, 2),
        },
      ],
    };
  }
}
