import { McpController, Resource } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';

@McpController()
export class GreetingResource {
  @Resource({
    name: 'languages-informal-greetings',
    description: 'Languages and their informal greeting phrases',
    mimeType: 'application/json',
    uri: 'mcp://languages/informal-greetings',
  })
  getLanguagesInformalGreetings(@Payload() { uri }: { uri: string }) {
    const languages = {
      en: 'Hey',
      es: 'Qué tal',
      fr: 'Salut',
      de: 'Hi',
      it: 'Ciao',
      pt: 'Oi',
      ja: 'やあ',
      ko: '안녕',
      zh: '嗨',
    };

    return {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify(languages, null, 2),
        },
      ],
    };
  }

  @Resource({
    name: 'config-data',
    description: 'Application configuration',
    mimeType: 'application/json',
    uri: 'mcp://config/app',
  })
  getConfig(@Payload() { uri }: { uri: string }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({ version: '1.0', debug: true }),
        },
      ],
    };
  }

  @Resource({
    name: 'help-text',
    description: 'Help documentation',
    mimeType: 'text/plain',
    uri: 'mcp://help/usage',
  })
  getHelp(@Payload() { uri }: { uri: string }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/plain',
          text: 'This is how you use the application...',
        },
      ],
    };
  }

  @Resource({
    name: 'readme',
    description: 'Project documentation',
    mimeType: 'text/markdown',
    uri: 'mcp://docs/readme',
  })
  getReadme(@Payload() { uri }: { uri: string }) {
    return {
      contents: [
        {
          uri,
          mimeType: 'text/markdown',
          text: '# My Project\n\nThis project does amazing things...',
        },
      ],
    };
  }
}
