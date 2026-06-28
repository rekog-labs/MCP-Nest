# Built-in Authorization Server

The `McpAuthModule` provides a complete OAuth 2.1 compliant Identity Provider (IdP) implementation for securing MCP servers. It fully implements the [MCP Authorization specification (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization) and includes built-in support for popular OAuth providers like [GitHub](../packages/mcp-nest-auth/src/providers/github.provider.ts) and [Google](../packages/mcp-nest-auth/src/providers/google.provider.ts).

## Features

- **🔒 OAuth 2.1 Compliance**: Fully compliant with OAuth 2.1 and MCP Authorization specification
- **🏪 Multiple Storage Options**: In-memory (testing), TypeORM (production), or custom storage backends
- **🌐 Provider Support**: Built-in GitHub and Google OAuth providers with extensible provider system
- **🔑 Dynamic Client Registration**: RFC 7591 compliant client registration
- **📊 Authorization Server Discovery**: RFC 8414 and RFC 9728 compliant metadata endpoints
- **🛡️ Security**: PKCE, Resource Indicators (RFC 8707), and comprehensive token validation
- **⚡ NestJS Integration**: Seamless integration with NestJS dependency injection and guards

## Quick Start

The fastest way to try out Remote MCP servers with built-in authentication is by deploying on Railway with the template below:

[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/G6BLGK?referralCode=XAdIhJ)

For the deployment you need the following:

1. Create a [New GitHub App](https://github.com/settings/applications/new), required for user authentication
    - For the "Authorization callback URL" add the placeholder `http://localhost:3000/auth/callback` and create the app, you will update it at step 4.
2. Add the GitHub Client ID and Client Secret in the Deploy panel on Railway, and click "Deploy"
3. After the app is deployed, the Custom Domain is available in the railway deployment settings page.
4. Update the "Authorization callback URL" of the GitHub app to the custom domain with the postfix as shown here: `https://<custom-domain>.up.railway.app/auth/callback`.

**And you are ready to roll!**

Open MCP Inspector at `https://<custom-domain>.up.railway.app/mcp` to see the available resources and tools.

The code of the deployed project is in this GitHub repository: [rekog-labs/mcp-nest-auth-starter](https://github.com/rekog-labs/mcp-nest-auth-starter).

## Setting up a new project

The `McpAuthModule` still provides the OAuth 2.1 controllers exactly as before.
MCP itself runs as a `McpStrategy` microservice, and the MCP transport routes
are protected with Express middleware that validates the Bearer JWT (reusing the
module's `JwtTokenService`) and sets `req.user`. Per-tool access is then enforced
with standard NestJS `@UseGuards()` on `@McpController` classes/methods and/or
the `@PublicTool()`/`@ToolScopes()`/`@ToolRoles()` decorators.

The built-in authorization server lives in a separate package. Install it alongside `@rekog/mcp-nest`:

```bash
npm install @rekog/mcp-nest-auth
```

```typescript
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
// Or if you are using CommonJS:
// import * as cookieParser from 'cookie-parser';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import {
  McpAuthModule,
  GitHubOAuthProvider,
  JwtTokenService,
} from '@rekog/mcp-nest-auth';
import { GreetingTool } from './greeting.tool';

const mcp = new McpStrategy({
  name: 'secure-mcp-server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport()],
});

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      resource: 'http://localhost:3030/mcp',
      serverUrl: 'http://localhost:3030',
      apiPrefix: 'auth',
    }),
  ],
  controllers: [GreetingTool], // your @McpController() classes
})
class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Required for OAuth session management
  app.use(cookieParser());

  // Enable CORS for client applications
  app.enableCors({
    origin: true,
    credentials: true,
  });

  mcp.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy: mcp });

  // Protect only the MCP transport routes; leave the OAuth endpoints
  // (/auth/*, /.well-known/*) open so the handshake can run.
  const jwt = app.get(JwtTokenService);
  const mcpRoutes = ['/mcp'];
  app.use((req: any, res: any, next: () => void) => {
    const path: string = req.path ?? req.url ?? '';
    const isMcpRoute = mcpRoutes.some(
      (p) => path === p || path.startsWith(`${p}?`) || path.startsWith(`${p}/`),
    );
    if (!isMcpRoute) return next();

    const auth: string | undefined = req.headers?.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    if (!token) { res.statusCode = 401; res.end('Unauthorized'); return; }

    const payload = jwt.validateToken(token);
    if (!payload) { res.statusCode = 401; res.end('Unauthorized'); return; }

    req.user = payload;
    next();
  });

  await app.startAllMicroservices(); // BEFORE listen()
  await app.listen(3030);
  console.log('Secure MCP Server running on http://localhost:3030');
}
void bootstrap();
```

Install dependencies:

```bash
npm install --save cookie-parser
npm install --save-dev @types/cookie-parser
```

## Reading the Authenticated User

The middleware (or guard) above validates the token and sets `req.user`. Inside a
tool, inject it directly with `@McpUser()` — the auth-aware param decorator that
projects `req.user` (sugar over `@McpRawRequest()` + `.user`):

```typescript
import { McpController, Tool } from '@rekog/mcp-nest';
import { McpUser, McpUserPayload } from '@rekog/mcp-nest-auth';

@McpController()
export class GreetingTool {
  @Tool({ name: 'whoami', description: 'Return the authenticated user' })
  whoami(@McpUser() user?: McpUserPayload) {
    return {
      content: [
        { type: 'text', text: `Hello, ${user?.displayName ?? 'anonymous'}!` },
      ],
    };
  }
}
```

Pass a field name to project a single property, e.g. `@McpUser('email') email?: string`.

## Configuration Options

### Required Options

| Option | Type | Description |
|--------|------|-------------|
| `provider` | [`OAuthProviderConfig`](../packages/mcp-nest-auth/src/providers/oauth-provider.interface.ts) | OAuth provider configuration ([GitHubOAuthProvider](../packages/mcp-nest-auth/src/providers/github.provider.ts), [GoogleOAuthProvider](../packages/mcp-nest-auth/src/providers/google.provider.ts), or custom) |
| `clientId` | `string` | OAuth client ID from your provider |
| `clientSecret` | `string` | OAuth client secret from your provider |
| `jwtSecret` | `string` | JWT signing secret (minimum 32 characters) |

### Optional Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | `string` | `'https://localhost:3000'` | Base URL of your server |
| `jwtIssuer` | `string` | `serverUrl` | JWT issuer claim |
| `jwtAudience` | `string` | `'mcp-client'` | JWT audience claim |
| `jwtAccessTokenExpiresIn` | `string` | `'1d'` | Access token expiration |
| `jwtRefreshTokenExpiresIn` | `string` | `'30d'` | Refresh token expiration |
| `enableRefreshTokens` | `boolean` | `true` | Issue refresh tokens for offline access |
| `apiPrefix` | `string` | `''` | Prefix for all OAuth endpoints |
| `cookieSecure` | `boolean` | `nodeEnv === 'production'` | Use secure cookies |
| `cookieMaxAge` | `number` | `24 * 60 * 60 * 1000` | Cookie expiration (24 hours) |
| `oauthSessionExpiresIn` | `number` | `10 * 60 * 1000` | OAuth session timeout (10 minutes) |
| `authCodeExpiresIn` | `number` | `10 * 60 * 1000` | Authorization code timeout (10 minutes) |
| `endpoints` | `object` | See below | Custom endpoint paths |
| `disableEndpoints` | `{ wellKnownAuthorizationServerMetadata?: boolean; wellKnownProtectedResourceMetadata?: boolean }` | `{ wellKnownAuthorizationServerMetadata: false, wellKnownProtectedResourceMetadata: false }` | Disable specific discovery endpoints without changing their paths |
| `storeConfiguration` | [`IOAuthStore`](../packages/mcp-nest-auth/src/stores/oauth-store.interface.ts) | In-memory | Storage backend configuration |

### Endpoint Configuration

```typescript
{
  endpoints: {
    // RFC 8414 (Authorization Server Metadata)
    wellKnownAuthorizationServerMetadata: '/.well-known/oauth-authorization-server',
    // RFC 9728 (Protected Resource Metadata / MCP discovery)
    wellKnownProtectedResourceMetadata: '/.well-known/oauth-protected-resource',
    // OAuth 2.1 flow endpoints
    register: '/register',
    authorize: '/authorize',
    callback: '/callback',
    token: '/token',
    revoke: '/revoke',
  }
}
```

### Disabling Discovery Endpoints

You can keep endpoint paths configured while preventing route registration via `disableEndpoints`:

```typescript
McpAuthModule.forRoot({
  // ... required options
  disableEndpoints: {
    wellKnownAuthorizationServerMetadata: true, // disables GET /.well-known/oauth-authorization-server
    wellKnownProtectedResourceMetadata: false,  // keeps GET /.well-known/oauth-protected-resource
  },
});
```

## Storage Backends

### In-Memory Store (Default)

Perfect for development and testing:

```typescript
McpAuthModule.forRoot({
  // ... other options
  // No storeConfiguration needed - uses in-memory by default
})
```

### TypeORM Store

For production use with persistent storage:

```typescript
McpAuthModule.forRoot({
  // ... other options
  storeConfiguration: {
    type: 'typeorm',
    options: {
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'user',
      password: 'password',
      database: 'oauth_db',
      synchronize: true, // Set to false in production
      logging: false,
    },
  },
})
```

> **Note**: The TypeORM store requires the optional peer dependencies `@nestjs/typeorm` and `typeorm` to be installed.

Supported TypeORM databases: PostgreSQL, MySQL, SQLite, SQL Server, Oracle, and more.

### Custom Store

Implement your own storage backend. See: [IOAuthStore interface](../packages/mcp-nest-auth/src/stores/oauth-store.interface.ts)

```typescript
import { IOAuthStore } from '@rekog/mcp-nest-auth';

class CustomStore implements IOAuthStore {
  // Implement required methods
}

McpAuthModule.forRoot({
  // ... other options
  storeConfiguration: {
    type: 'custom',
    store: new CustomStore(),
  },
})
```

## OAuth Providers

### GitHub Provider

See: [GitHubOAuthProvider](../packages/mcp-nest-auth/src/providers/github.provider.ts)

```typescript
import { GitHubOAuthProvider } from '@rekog/mcp-nest-auth';

// GitHub App setup required:
// 1. Create GitHub App at https://github.com/settings/apps
// 2. Set Authorization callback URL to: https://your-server.com/callback
// 3. Note the Client ID and generate Client Secret

McpAuthModule.forRoot({
  provider: GitHubOAuthProvider,
  clientId: process.env.GITHUB_CLIENT_ID!,
  clientSecret: process.env.GITHUB_CLIENT_SECRET!,
  // ... other options
})
```

### Google Provider

See: [GoogleOAuthProvider](../packages/mcp-nest-auth/src/providers/google.provider.ts)

```typescript
import { GoogleOAuthProvider } from '@rekog/mcp-nest-auth';

// Google Cloud Console setup required:
// 1. Create OAuth 2.0 Client ID at https://console.cloud.google.com/apis/credentials
// 2. Add redirect URI: https://your-server.com/callback
// 3. Note the Client ID and Client Secret

McpAuthModule.forRoot({
  provider: GoogleOAuthProvider,
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  // ... other options
})
```

### Custom Provider

Create your own OAuth provider. See: [OAuthProviderConfig](../packages/mcp-nest-auth/src/providers/oauth-provider.interface.ts):

```typescript
import { OAuthProviderConfig } from '@rekog/mcp-nest-auth'; //

export const CustomOAuthProvider: OAuthProviderConfig = {
  name: 'custom',
  strategy: CustomStrategy, // Implement Passport strategy
  scopes: ['read:user'],
};
```

## API Endpoints

When `apiPrefix` is set to `'auth'`, the following endpoints are available:

### Authorization Server Metadata

- **GET** `/.well-known/oauth-authorization-server` - OAuth server metadata (RFC 8414) [can be disabled]

### Protected Resource Metadata

- **GET** `/.well-known/oauth-protected-resource` - Protected Resource metadata (RFC 9728, used by MCP for discovery) [can be disabled]

### OAuth Flow Endpoints

- **POST** `/register` - Dynamic client registration (RFC 7591)
- **GET** `/authorize` - Authorization endpoint
- **GET** `/callback` - OAuth callback endpoint
- **POST** `/token` - Token endpoint
- **POST** `/revoke` - Token revocation

## Environment Variables

Create a `.env` file with the required variables:

```bash
# OAuth Provider (GitHub example)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-at-least-32-characters-long

# Server Configuration
SERVER_URL=https://your-server.com

# Database (if using TypeORM)
DATABASE_URL=postgresql://user:password@localhost:5432/oauth_db
```

## Troubleshooting

### Common Issues

1. **JWT Secret Too Short**: Ensure `jwtSecret` is at least 32 characters
2. **Invalid Redirect URI**: OAuth provider redirect URI must match `{serverUrl}/{apiPrefix}/callback`
3. **CORS Issues**: Enable CORS with `credentials: true` for browser-based clients
4. **Cookie Problems**: Ensure `cookieParser()` middleware is installed for session management
