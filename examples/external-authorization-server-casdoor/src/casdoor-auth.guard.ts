import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { extractBearer, verifyCasdoorToken } from './casdoor-token';

const PORT = Number(process.env.PORT ?? 3030);
const SERVER_URL = process.env.SERVER_URL ?? `http://localhost:${PORT}`;
const CASDOOR_URL = process.env.CASDOOR_URL ?? 'http://localhost:8000';
const RESOURCE_METADATA_URL = `${SERVER_URL}/.well-known/oauth-protected-resource/mcp`;

/**
 * Authenticates MCP traffic by validating a Casdoor RS256 access token.
 *
 * This is the recommended way to protect the MCP server: a normal NestJS guard
 * on a real MCP controller (see `mcp.controller.ts`). Because the route is a
 * Nest controller route, `@UseGuards(CasdoorAuthGuard)` applies to the whole MCP
 * surface in one place — every tool/resource/prompt behind `/mcp` — and composes
 * with the rest of the Nest pipeline (interceptors, filters, versioning).
 *
 * On a missing/invalid token it returns HTTP 401 with a `WWW-Authenticate`
 * header pointing at the protected-resource metadata, which is how MCP clients
 * discover the authorization server (MCP spec 2025-06-18 / RFC 9728).
 */
@Injectable()
export class CasdoorAuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const res = context.switchToHttp().getResponse<Response>();

    const token = extractBearer(req.headers.authorization);
    if (!token) {
      this.deny(res, 'missing Bearer access token');
    }

    try {
      req.user = await verifyCasdoorToken(token, {
        issuer: CASDOOR_URL,
        jwksUri: `${CASDOOR_URL}/.well-known/jwks`,
        // No `audience`: Casdoor sets aud=client_id, not the MCP resource URL.
        // See the RFC 8707 note in casdoor-token.ts.
      });
      return true;
    } catch (error) {
      this.deny(res, `invalid access token (${(error as Error).message})`);
    }
  }

  /** Emit the RFC 9728 discovery hint, then 401. */
  private deny(res: Response, message: string): never {
    res.setHeader(
      'WWW-Authenticate',
      `Bearer resource_metadata="${RESOURCE_METADATA_URL}"`,
    );
    throw new UnauthorizedException(`Unauthorized: ${message}`);
  }
}
