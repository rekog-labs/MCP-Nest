import { McpController, Resource } from '@rekog/mcp-nest';

@McpController()
export class GreetingResource {
  @Resource({
    uri: 'mcp://greeting',
    name: 'greeting',
    description: 'A static greeting resource',
    mimeType: 'text/plain',
  })
  async getGreeting() {
    return {
      contents: [{ uri: 'mcp://greeting', mimeType: 'text/plain', text: 'Hello from mcp-nest!' }],
    };
  }
}
