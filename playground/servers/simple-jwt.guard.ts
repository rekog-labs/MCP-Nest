import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Optional,
} from '@nestjs/common';
import { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { McpOptions } from '../../src/mcp/interfaces/mcp-options.interface';

@Injectable()
export class SimpleJwtGuard implements CanActivate {
  private readonly jwtSecret: string;

  constructor(
    @Optional()
    @Inject('MCP_OPTIONS')
    private readonly options?: McpOptions,
  ) {
    this.jwtSecret =
      process.env.JWT_SECRET ||
      'your_super_secret_jwt_key_at_least_32_characters_long';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    const allowUnauthenticated =
      this.options?.allowUnauthenticatedAccess ?? false;

    if (!token) {
      if (allowUnauthenticated) {
        return true;
      } else {
        throw new UnauthorizedException('Access token required');
      }
    }

    try {
      const payload = jwt.verify(token, this.jwtSecret);
      request.user = payload;
      return true;
    } catch (error) {
      throw new UnauthorizedException('Invalid token');
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
