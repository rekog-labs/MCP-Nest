/**
 * Example: OAuth Server with Azure AD Provider
 *
 * This example demonstrates how to set up an MCP server (a NestJS microservice
 * transport strategy) protected by the OAuth 2.1 module using Azure AD as the
 * identity provider with TypeORM for persistent storage.
 */

import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { McpStrategy, StreamableHttpTransport } from '@rekog/mcp-nest';
import { AzureADOAuthProvider, McpAuthModule } from '@rekog/mcp-nest-auth';
import { GreetingTool } from '../resources/greeting.tool';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingPrompt } from '../resources/greeting.prompt';

const JWT_SECRET =
  process.env.JWT_SECRET || 'super-secret-jwt-key-min-32-characters';

// The MCP server is a microservice transport strategy. McpAuthModule (the OAuth
// 2.1 module, NOT McpModule) still provides the register/authorize/token/
// well-known controllers and is kept in `imports`.
const strategy = new McpStrategy({
  name: 'OAuth Azure AD Server',
  version: '1.0.0',
  transports: [new StreamableHttpTransport()],
});

@Module({
  imports: [
    McpAuthModule.forRoot({
      // Azure AD Provider Configuration
      provider: AzureADOAuthProvider,

      // Required OAuth Configuration
      clientId: process.env.AZURE_AD_CLIENT_ID || 'your-azure-app-client-id',
      clientSecret:
        process.env.AZURE_AD_CLIENT_SECRET || 'your-azure-app-client-secret',

      // Required JWT Configuration
      jwtSecret: JWT_SECRET,

      // Server Configuration
      serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
      resource: process.env.RESOURCE_URL || 'http://localhost:3000/mcp',

      // TypeORM Storage Configuration
      storeConfiguration: {
        type: 'typeorm',
        options: {
          type: 'sqlite',
          database: 'oauth-azure-ad.db',
          synchronize: true,
          logging: false,
        },
      },

      // Optional: Customize endpoints
      apiPrefix: 'auth',

      // Optional: JWT Configuration
      jwtIssuer: process.env.JWT_ISSUER || 'http://localhost:3000',
      jwtAudience: process.env.JWT_AUDIENCE || 'mcp-client',
      jwtAccessTokenExpiresIn: '1d',
      jwtRefreshTokenExpiresIn: '7d',

      // Optional: Cookie Configuration
      cookieSecure: process.env.NODE_ENV === 'production',
      cookieMaxAge: 24 * 60 * 60 * 1000, // 24 hours

      // Optional: Session Configuration
      oauthSessionExpiresIn: 15 * 60 * 1000, // 15 minutes
      authCodeExpiresIn: 5 * 60 * 1000, // 5 minutes
    }),
  ],
  // Capability classes are controllers now.
  controllers: [GreetingTool, GreetingResource, GreetingPrompt],
})
export class AzureADServerModule {}

// Gate only the MCP transport routes, leaving /auth/* and /.well-known/*
// open so the OAuth handshake can run.
const MCP_ROUTE_PREFIXES = ['/mcp'];

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
  // Create the NestJS application
  const app = await NestFactory.create(AzureADServerModule);

  // Enable CORS for OAuth flows
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  });

  const strategyAdapter = app.getHttpAdapter();
  strategy.setHttpAdapter(strategyAdapter);
  app.connectMicroservice({ strategy });
  app.use(mcpAuthMiddleware);
  await app.startAllMicroservices();

  // Start the server
  const port = process.env.PORT || 3000;
  await app.listen(port);

  console.log('\n🚀 Azure AD OAuth Server started!');
  console.log(`Server: http://localhost:${port}`);
  console.log(`MCP Endpoint: http://localhost:${port}/mcp`);
  console.log('\n📋 OAuth Endpoints:');
  console.log(`  Authorization: http://localhost:${port}/auth/authorize`);
  console.log(`  Token: http://localhost:${port}/auth/token`);
  console.log(`  Callback: http://localhost:${port}/auth/callback`);
  console.log(`  Register: http://localhost:${port}/auth/register`);
  console.log('\n🔍 Well-known Endpoints:');
  console.log(
    `  Authorization Server: http://localhost:${port}/.well-known/oauth-authorization-server`,
  );
  console.log(
    `  Protected Resource: http://localhost:${port}/.well-known/oauth-protected-resource`,
  );
  console.log('\n⚙️  Configuration:');
  console.log(`  Provider: Azure AD (Microsoft)`);
  console.log(`  Storage: TypeORM SQLite`);
  console.log(
    `  Client ID: ${process.env.AZURE_AD_CLIENT_ID || 'Not configured'}`,
  );
  console.log('\n📖 Setup Instructions:');
  console.log(
    '1. Create an Azure AD App Registration at https://portal.azure.com',
  );
  console.log('2. Configure redirect URI: http://localhost:3000/auth/callback');
  console.log('3. Set environment variables:');
  console.log('   - AZURE_AD_CLIENT_ID=<your-client-id>');
  console.log('   - AZURE_AD_CLIENT_SECRET=<your-client-secret>');
  console.log('   - JWT_SECRET=<secure-32-character-secret>');
}

// Start the server if this file is run directly
if (require.main === module) {
  bootstrap().catch((error) => {
    console.error('❌ Failed to start Azure AD OAuth server:', error);
    process.exit(1);
  });
}

export { bootstrap };
