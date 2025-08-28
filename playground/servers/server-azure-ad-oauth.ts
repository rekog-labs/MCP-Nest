/**
 * Example: OAuth Server with Azure AD Provider
 * 
 * This example demonstrates how to set up an OAuth server using Azure AD
 * as the identity provider with TypeORM for persistent storage.
 */

import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { McpModule } from '../../src/mcp/mcp.module';
import { McpTransportType } from '../../src/mcp/interfaces';
import { McpAuthModule, AzureADOAuthProvider } from '../../src/authz';
import { GreetingTool } from '../resources/greeting.tool';
import { GreetingResource } from '../resources/greeting.resource';
import { GreetingPrompt } from '../resources/greeting.prompt';

@Module({
  imports: [
    McpModule.forRoot({
      transport: McpTransportType.SSE,
      name: 'OAuth Azure AD Server',
      version: '1.0.0',
    }),
    McpAuthModule.forRoot({
      // Azure AD Provider Configuration
      provider: AzureADOAuthProvider,
      
      // Required OAuth Configuration
      clientId: process.env.AZURE_AD_CLIENT_ID || 'your-azure-app-client-id',
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET || 'your-azure-app-client-secret',
      
      // Required JWT Configuration
      jwtSecret: process.env.JWT_SECRET || 'super-secret-jwt-key-min-32-characters',
      
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
      jwtAccessTokenExpiresIn: '1h',
      jwtRefreshTokenExpiresIn: '7d',
      
      // Optional: Cookie Configuration  
      cookieSecure: process.env.NODE_ENV === 'production',
      cookieMaxAge: 24 * 60 * 60 * 1000, // 24 hours
      
      // Optional: Session Configuration
      oauthSessionExpiresIn: 15 * 60 * 1000, // 15 minutes
      authCodeExpiresIn: 5 * 60 * 1000, // 5 minutes
    }),
  ],
  providers: [GreetingTool, GreetingResource, GreetingPrompt],
})
export class AzureADServerModule {}

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
  console.log(`  Authorization Server: http://localhost:${port}/.well-known/oauth-authorization-server`);
  console.log(`  Protected Resource: http://localhost:${port}/.well-known/oauth-protected-resource`);
  console.log('\n⚙️  Configuration:');
  console.log(`  Provider: Azure AD (Microsoft)`);
  console.log(`  Storage: TypeORM SQLite`);
  console.log(`  Client ID: ${process.env.AZURE_AD_CLIENT_ID || 'Not configured'}`);
  console.log('\n📖 Setup Instructions:');
  console.log('1. Create an Azure AD App Registration at https://portal.azure.com');
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
