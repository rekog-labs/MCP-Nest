import { Controller, Module, UseGuards } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import * as dotenv from 'dotenv';
import 'reflect-metadata';
import {
  McpHttpControllerFor,
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import {
  GitHubOAuthProvider,
  McpAuthJwtGuard,
  McpAuthModule,
} from '@rekog/mcp-nest-auth';
import { GreetingPrompt } from '../resources/greeting.prompt';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingTool } from '../resources/greeting.tool';

dotenv.config();

const JWT_SECRET = process.env.JWT_SECRET!;
const allowUnauthenticatedAccess =
  process.env.ALLOW_UNAUTHENTICATED_ACCESS === 'true';

// The MCP server is a microservice transport strategy. The OAuth 2.1 module
// (McpAuthModule) is NOT McpModule — it still provides its register/authorize/
// token/well-known controllers (so it acts as the Authorization Server that
// delegates to GitHub) and is kept in `imports`.
//
// The transport is pulled out into a shared const so the guarded HTTP controller
// below can bind to the SAME instance via `McpHttpControllerFor(mcpTransport)`.
// Stateless is the default, so there is nothing to configure here.
const mcpTransport = new StreamableHttpTransport();

const strategy = new McpStrategy({
  name: 'playground-mcp-server',
  version: '0.0.1',
  transports: [mcpTransport],
  allowUnauthenticatedAccess,
});

// Authenticate the MCP surface with the library's own guard instead of bespoke
// middleware. `McpHttpControllerFor(mcpTransport)` makes this a real NestJS
// controller that owns the `/mcp` route (and auto-disables the transport's
// self-mount), so `McpAuthJwtGuard` runs once per request — validating the JWT
// minted by McpAuthModule and enriching `req.user` with username/displayName/
// name/scopes/roles that the tools read via `ctx.getRawRequest().user`.
@Controller('mcp')
@UseGuards(McpAuthJwtGuard)
class McpHttpController extends McpHttpControllerFor(mcpTransport) {}

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
  // The guarded MCP route + the @McpController() capability classes (RPC
  // handlers, not HTTP routes). McpAuthModule (imported) supplies the services.
  controllers: [
    McpHttpController,
    GreetingResource,
    GreetingTool,
    GreetingPrompt,
  ],
  providers: [
    McpAuthJwtGuard,
    // The guard reads `allowUnauthenticatedAccess` from the optional MCP_OPTIONS
    // token. Provide it explicitly so the flag works through the guard.
    { provide: 'MCP_OPTIONS', useValue: { allowUnauthenticatedAccess } },
  ],
})
class AppModule {}

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
  await app.startAllMicroservices();

  await app.listen(3030);
  console.log('MCP OAuth Server running on http://localhost:3030');
}
void bootstrap();
