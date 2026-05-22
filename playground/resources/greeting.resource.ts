import { Injectable, Scope } from '@nestjs/common';
import { Resource, ResourceTemplate } from '@rekog/mcp-nest';

@Injectable({ scope: Scope.REQUEST })
export class GreetingResource {
  constructor() {}

  @Resource({
    name: 'languages-informal-greetings',
    description: 'Languages and their informal greeting phrases',
    mimeType: 'application/json',
    uri: 'mcp://languages/informal-greetings',
  })
  getLanguagesInformalGreetings({ uri }) {
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
    const result = {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify(languages, null, 2),
        },
      ],
    };
    return result;
  }

  @ResourceTemplate({
    name: 'user-language',
    description: "Get a specific user's preferred language",
    mimeType: 'application/json',
    uriTemplate: 'mcp://users/{name}',
  })
  getUserLanguage({ uri, name }) {
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
    const result = {
      contents: [
        {
          uri: uri,
          mimeType: 'application/json',
          text: JSON.stringify({ name, language }, null, 2),
        },
      ],
    };
    return result;
  }
}
