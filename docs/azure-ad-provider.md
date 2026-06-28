# Azure AD OAuth Provider

This guide explains how to integrate Microsoft Azure Active Directory (Azure AD) as an OAuth 2.0 identity provider with your MCP NestJS application.

## Prerequisites

1. **Azure AD Tenant**: You need access to an Azure AD tenant (work, school, or personal Microsoft account)
2. **App Registration**: Create an app registration in Azure AD
3. **NestJS Application**: A working NestJS application with `@rekog/mcp-nest`

## Setting up Azure AD App Registration

### Step 1: Create App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Click **New registration**
4. Fill in the details:
   - **Name**: Your application name (e.g., "My MCP Server")
   - **Supported account types**: Choose based on your needs
     - **Single tenant**: Only users in your organization
     - **Multi-tenant**: Users in any organization
     - **Personal accounts**: Include personal Microsoft accounts
   - **Redirect URI**: `http://localhost:3000/auth/callback` (adjust URL as needed)

### Step 2: Configure API Permissions

1. In your app registration, go to **API permissions**
2. Click **Add a permission** > **Microsoft Graph** > **Delegated permissions**
3. Add the following permissions:
   - `openid` (Sign users in)
   - `profile` (View users' basic profile)
   - `email` (View users' email address)
   - `User.Read` (Sign in and read user profile)

### Step 3: Create Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and set expiration
4. **Copy the secret value immediately** (you won't be able to see it again)

### Step 4: Note Your Configuration

Copy these values from your app registration:
- **Application (client) ID**: Found in the Overview section
- **Directory (tenant) ID**: Found in the Overview section  
- **Client secret**: The value you just created

## Implementation

### Basic Setup

The Azure AD provider ships with the built-in authorization server package. Install it alongside `@rekog/mcp-nest`:

```bash
npm install @rekog/mcp-nest-auth
```

```typescript
import { Module } from '@nestjs/common';
import {
  McpStrategy,
  StreamableHttpTransport,
} from '@rekog/mcp-nest';
import {
  McpAuthModule,
  AzureADOAuthProvider,
} from '@rekog/mcp-nest-auth';
import { MyTools } from './my-tools'; // your @McpController() classes

// MCP runs as a microservice strategy — there is no McpModule.
export const mcp = new McpStrategy({
  name: 'My MCP Server with Azure AD',
  version: '1.0.0',
  transports: [new StreamableHttpTransport()],
});

@Module({
  imports: [
    McpAuthModule.forRoot({
      // Azure AD Provider Configuration
      provider: AzureADOAuthProvider,

      // Required OAuth Configuration
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,

      // Required JWT Configuration
      jwtSecret: process.env.JWT_SECRET!,

      // Server Configuration
      serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
      apiPrefix: 'auth',
    }),
  ],
  controllers: [MyTools],
})
export class AppModule {}
```

Wire the strategy into your bootstrap and protect the MCP routes with
middleware that validates the Bearer JWT (see the
[Azure AD OAuth Provider](azure-ad-oauth-provider.md) guide for the full
`main.ts` example):

```typescript
const app = await NestFactory.create(AppModule);
mcp.setHttpAdapter(app.getHttpAdapter());
app.connectMicroservice({ strategy: mcp });
// app.use(...) to validate the token and set req.user on /mcp
await app.startAllMicroservices();
await app.listen(3000);
```

### Environment Variables

Create a `.env` file with your Azure AD configuration:

```env
# Azure AD OAuth Configuration
AZURE_AD_CLIENT_ID=your-application-client-id
AZURE_AD_CLIENT_SECRET=your-client-secret-value

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-minimum-32-characters

# Server Configuration (optional)
SERVER_URL=http://localhost:3000
```

For more details and advanced configuration options, see the full documentation in the repository.
