import { Injectable, Scope } from '@nestjs/common';
import { Resource, ResourceTemplate } from '../../src';

@Injectable({ scope: Scope.REQUEST })
export class GreetingResource {
  constructor() {}

  @Resource({
    name: 'hello-world',
    description: 'A simple hello world resource',
    mimeType: 'text/plain',
    uri: 'mcp://hello-world',
  })
  sayHelloWorld({ uri }) {
    return {
      contents: [
        {
          uri: uri,
          mimeType: 'text/plain',
          text: `Hello world`,
        },
      ],
    };
  }

  @ResourceTemplate({
    name: 'hello-world',
    description: 'A simple greeting resource',
    mimeType: 'text/plain',
    uriTemplate: 'mcp://hello-world/{name}',
  })
  sayHello({ uri, name }) {
    return {
      contents: [
        {
          uri: uri,
          mimeType: 'text/plain',
          text: `Hello ${name}`,
        },
      ],
    };
  }
}
