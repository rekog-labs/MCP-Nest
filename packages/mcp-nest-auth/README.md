# @rekog/mcp-nest-auth

An OAuth 2.1 / [MCP Authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)-compliant authorization server for [`@rekog/mcp-nest`](https://www.npmjs.com/package/@rekog/mcp-nest). It secures your MCP servers by federating user authentication to upstream identity providers (GitHub, Google, and Azure AD) and handling [dynamic client registration (RFC 7591)](https://datatracker.ietf.org/doc/html/rfc7591), so MCP clients can register themselves and obtain tokens without manual setup. It plugs into NestJS via `McpAuthModule` and exposes the `JwtTokenService`, OAuth provider configs, and pluggable storage backends (memory or TypeORM).

## Installation

This package has `@rekog/mcp-nest` as a peer dependency, so install both together:

```bash
npm install @rekog/mcp-nest @rekog/mcp-nest-auth
```

If you want to persist OAuth data with the TypeORM store, also install:

```bash
npm install @nestjs/typeorm typeorm
```

## Usage

```typescript
import { McpAuthModule, GitHubOAuthProvider } from '@rekog/mcp-nest-auth';

McpAuthModule.forRoot({
  provider: GitHubOAuthProvider,
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  jwtSecret: process.env.JWT_SECRET!,
  serverUrl: 'http://localhost:3030',
  apiPrefix: 'auth',
});
```

## Documentation

See the full guide at [`docs/built-in-authorization-server.md`](../../docs/built-in-authorization-server.md).
