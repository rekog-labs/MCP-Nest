import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import 'reflect-metadata';
import * as jwt from 'jsonwebtoken';
import {
  GitHubOAuthProvider,
  McpAuthModule,
  McpStrategy,
  SseTransport,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import { GreetingPrompt } from '../resources/greeting.prompt';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingTool } from '../resources/greeting.tool';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET!;
const allowUnauthenticatedAccess =
  process.env.ALLOW_UNAUTHENTICATED_ACCESS === 'true';

// The MCP server is now a microservice transport strategy. The OAuth 2.1 module
// (McpAuthModule) is NOT McpModule — it still provides its register/authorize/
// token/well-known controllers and is kept in `imports`. Its bespoke per-tool
// authorization (`@PublicTool`/`@ToolScopes`/`@ToolRoles`) reads `req.user`,
// which the JWT middleware below populates.
const strategy = new McpStrategy({
  name: 'playground-mcp-server',
  version: '0.0.1',
  transports: [
    new StreamableHttpTransport({ statelessMode: false }),
    new SseTransport(),
  ],
  allowUnauthenticatedAccess,
});

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: GitHubOAuthProvider,
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      jwtSecret: JWT_SECRET,
      serverUrl: process.env.SERVER_URL,
      resource: process.env.SERVER_URL + '/mcp',
      cookieSecure: process.env.NODE_ENV === 'production',
      apiPrefix: 'auth',
      endpoints: {
        wellKnownAuthorizationServerMetadata:
          '/.well-known/oauth-authorization-server',
        wellKnownProtectedResourceMetadata: [
          '/.well-known/oauth-protected-resource/mcp',
          '/.well-known/oauth-protected-resource',
        ],
      },
      disableEndpoints: {
        wellKnownAuthorizationServerMetadata: false,
        wellKnownProtectedResourceMetadata: false,
      },
      // Storage Configuration - choose one of the following options:

      // Option 1: Use in-memory store (default if not specified)
      // storeConfiguration: { type: 'memory' }
      // OR just omit storeConfiguration entirely for memory store

      // Option 2: Use TypeORM for persistent storage
      // storeConfiguration: {
      //   type: 'typeorm',
      //   options: {
      //     type: 'sqlite',
      //     database: './oauth.db',
      //     synchronize: true,
      //     logging: false,
      //   },
      // },

      // Option 3: Use Drizzle for persistent storage
      // storeConfiguration: {
      //   type: 'custom',
      //   store: new SQLiteStore('./sqlite-store.db'),
      // },
    }),
  ],
  // Capability classes are controllers now; the OAuth module supplies services.
  controllers: [GreetingResource, GreetingTool, GreetingPrompt],
})
class AppModule {}

// Only gate the MCP transport routes; the OAuth controller endpoints
// (/auth/*, /.well-known/*) must stay open so the handshake can run.
const MCP_ROUTE_PREFIXES = ['/mcp', '/sse', '/messages'];

function mcpAuthMiddleware(req: any, res: any, next: () => void) {
  const path: string = req.path ?? req.url ?? '';
  const isMcpRoute = MCP_ROUTE_PREFIXES.some(
    (prefix) =>
      path === prefix ||
      path.startsWith(`${prefix}?`) ||
      path.startsWith(`${prefix}/`),
  );
  if (!isMcpRoute) {
    return next();
  }

  const authHeader: string | undefined = req.headers?.authorization;
  const token =
    authHeader && authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : undefined;

  if (!token) {
    if (allowUnauthenticatedAccess) {
      return next();
    }
    res.statusCode = 401;
    res.end('Unauthorized');
    return;
  }

  try {
    // Validate the access token minted by McpAuthModule (same jwtSecret).
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.statusCode = 401;
    res.end('Unauthorized');
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Enable cookie parser for session management
  app.use(cookieParser());

  // Enable CORS for development (configure properly for production)
  app.enableCors({
    origin: true,
    credentials: true,
  });

  strategy.setHttpAdapter(app.getHttpAdapter());
  app.connectMicroservice({ strategy });
  app.use(mcpAuthMiddleware);
  await app.startAllMicroservices();

  await app.listen(3030);
  console.log('MCP OAuth Server running on http://localhost:3030');
}
void bootstrap();
