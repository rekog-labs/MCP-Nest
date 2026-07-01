import { Injectable } from '@nestjs/common';

export interface User {
  name: string;
  email: string;
}

@Injectable()
export class UserRepository {
  private readonly users: User[] = [
    { name: 'World', email: 'world@example.com' },
    { name: 'Alice', email: 'alice@example.com' },
  ];

  async findByName(name: string): Promise<User | undefined> {
    return this.users.find((u) => u.name === name);
  }
}
