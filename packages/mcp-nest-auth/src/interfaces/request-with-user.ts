import type { Request } from 'express';
import type { JwtPayload } from '../services/jwt-token.service';

// Enriched user payload placed on request.user by McpAuthJwtGuard
export type McpUserPayload = JwtPayload & {
  name?: string;
  username?: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
};

// Express Request with enriched user information
export type McpRequestWithUser = Request & {
  user: McpUserPayload;
};
