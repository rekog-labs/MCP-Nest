import { McpController, Resource } from '@rekog/mcp-nest';
import { Payload } from '@nestjs/microservices';
import { UserRepository } from './user.repository';

@McpController()
export class GreetingResource {
  constructor(private readonly userRepository: UserRepository) {}

  @Resource({
    name: 'user-directory',
    description: 'Looks up a user via the injected UserRepository',
    mimeType: 'application/json',
    uri: 'mcp://users/world',
  })
  async getUser(@Payload() { uri }: { uri: string }) {
    const user = await this.userRepository.findByName('World');
    return {
      contents: [
        {
          uri,
          mimeType: 'application/json',
          text: JSON.stringify(user),
        },
      ],
    };
  }
}
