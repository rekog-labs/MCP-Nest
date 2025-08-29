# Azure AD OAuth Provider

The Azure AD OAuth provider enables authentication using Microsoft Azure Active Directory (Azure AD) for your MCP (Model Context Protocol) server. This allows users to authenticate using their Microsoft work, school, or personal accounts.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Azure AD App Registration](#azure-ad-app-registration)
- [Configuration](#configuration)
- [Usage Examples](#usage-examples)
- [Profile Mapping](#profile-mapping)
- [Scopes and Permissions](#scopes-and-permissions)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Overview

The Azure AD provider implements OAuth 2.0 / OpenID Connect authentication flow with Microsoft Azure Active Directory. It supports:

- **Multi-tenant authentication** (work, school, and personal Microsoft accounts)
- **Single-tenant authentication** (organization-specific)
- **Microsoft Graph API integration** for user profile data
- **Standard OAuth 2.0 flows** with PKCE support
- **JWT token-based authentication** for MCP server access

## Prerequisites

1. **Azure subscription** or access to Azure Active Directory
2. **MCP-Nest framework** installed in your project
3. **Administrative privileges** to create app registrations in Azure AD

## Azure AD App Registration

### Step 1: Create App Registration

1. Go to the [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory** > **App registrations**
3. Click **New registration**
4. Fill in the registration details:
   ```
   Name: Your MCP Server App
   Supported account types: Accounts in any organizational directory and personal Microsoft accounts
   Redirect URI: http://localhost:3000/auth/callback (adjust for your server URL)
   ```
5. Click **Register**

### Step 2: Configure Authentication

1. In your app registration, go to **Authentication**
2. Under **Redirect URIs**, ensure your callback URL is correct:
   ```
   http://localhost:3000/auth/callback
   https://yourdomain.com/auth/callback  (for production)
   ```
3. Under **Implicit grant and hybrid flows**, you can leave everything unchecked (we use authorization code flow)
4. Save the configuration

### Step 3: Generate Client Secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and select expiration period
4. Click **Add**
5. **Copy the secret value immediately** (you won't be able to see it again)

### Step 4: Configure API Permissions (Optional)

1. Go to **API permissions**
2. The following permissions are requested by default:
   - `openid` - Sign users in
   - `profile` - View users' basic profile
   - `email` - View users' email address
   - `User.Read` - Read user profile from Microsoft Graph

3. For additional permissions, click **Add a permission** and select **Microsoft Graph**

### Step 5: Note Configuration Values

Copy these values for your application configuration:
- **Application (client) ID** - This is your `clientId`
- **Directory (tenant) ID** - Your tenant ID (optional, defaults to 'common')
- **Client secret value** - This is your `clientSecret`

## Configuration

### Basic Configuration

```typescript
import { McpAuthModule, AzureADOAuthProvider } from '@rekog/mcp-nest';

@Module({
  imports: [
    McpAuthModule.forRoot({
      provider: AzureADOAuthProvider,
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      serverUrl: process.env.SERVER_URL || 'http://localhost:3000',
      resource: process.env.RESOURCE_URL || 'http://localhost:3000/mcp',
      
      // Optional: TypeORM storage
      storeConfiguration: {
        type: 'typeorm',
        options: {
          type: 'sqlite',
          database: 'oauth-azure-ad.db',
          synchronize: true,
        },
      },
      
      // Optional: Customize endpoints
      apiPrefix: 'auth',
    }),
  ],
})
export class AppModule {}
```

> **Note**: Using the TypeORM store requires installing `@nestjs/typeorm` and `typeorm`.

### Environment Variables

Create a `.env` file with your Azure AD configuration:

```bash
# Azure AD Configuration
AZURE_AD_CLIENT_ID=your-azure-app-client-id
AZURE_AD_CLIENT_SECRET=your-azure-app-client-secret

# JWT Configuration
JWT_SECRET=your-super-secure-jwt-secret-at-least-32-characters

# Server Configuration
SERVER_URL=http://localhost:3000
RESOURCE_URL=http://localhost:3000/mcp

# Optional: Database
DATABASE_URL=sqlite:./oauth-azure-ad.db
```

### Advanced Configuration

```typescript
McpAuthModule.forRoot({
  provider: {
    ...AzureADOAuthProvider,
    // Override default strategy options
    strategyOptions: ({ serverUrl, clientId, clientSecret, callbackPath }) => ({
      clientID: clientId,
      clientSecret: clientSecret,
      callbackURL: `${serverUrl}/${callbackPath}`,
      tenant: 'your-tenant-id', // Specific tenant instead of 'common'
      resource: 'https://graph.microsoft.com/',
      prompt: 'select_account', // Force account selection
    }),
    // Override default scopes
    scope: ['openid', 'profile', 'email', 'User.Read', 'User.ReadWrite'],
  },
  // ... other options
})
```

## Usage Examples

### Complete Server Example

```typescript
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { McpModule } from '@rekog/mcp-nest';
import { McpTransportType } from '@rekog/mcp-nest/interfaces';
import { McpAuthModule, AzureADOAuthProvider } from '@rekog/mcp-nest/authz';

@Module({
  imports: [
    McpModule.forRoot({
      name: 'Azure AD MCP Server',
      version: '1.0.0',
      transport: [McpTransportType.SSE, McpTransportType.STREAMABLE_HTTP],
    }),
    McpAuthModule.forRoot({
      provider: AzureADOAuthProvider,
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET!,
      jwtSecret: process.env.JWT_SECRET!,
      serverUrl: 'http://localhost:3000',
      storeConfiguration: {
        type: 'typeorm',
        options: {
          type: 'sqlite',
          database: 'oauth.db',
          synchronize: true,
        },
      },
      apiPrefix: 'auth',
    }),
  ],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  await app.listen(3000);
  
  console.log('🚀 Server running on http://localhost:3000');
  console.log('🔐 Login at http://localhost:3000/auth/authorize?response_type=code&client_id=your-client-id&redirect_uri=http://localhost:3000/auth/callback');
}

bootstrap();
```

### Client Integration

```typescript
import { AzureADOAuthClient } from './azure-ad-oauth-client';

const client = new AzureADOAuthClient({
  serverUrl: 'http://localhost:3000',
  clientId: 'your-azure-app-client-id',
  clientSecret: 'your-azure-app-client-secret',
});

// Step 1: Get authorization URL
const authUrl = client.getAuthorizationUrl();
console.log('Visit:', authUrl);

// Step 2: After user authentication, exchange code for token
const tokenResponse = await client.exchangeCodeForToken(authCode, state);

// Step 3: Use token to access MCP resources
const tools = await client.listTools(tokenResponse.access_token);
const result = await client.callTool(tokenResponse.access_token, 'my-tool', { param: 'value' });
```

## Profile Mapping

The Azure AD provider maps user profile data from Microsoft Graph to the standard MCP user profile format:

```typescript
interface MappedProfile {
  id: string;          // Azure AD user ID (id or oid)
  username: string;    // userPrincipalName or email
  email: string;       // mail or userPrincipalName
  displayName: string; // displayName or name
  avatarUrl?: string;  // profile photo URL (if available)
  raw: any;           // Original Azure AD profile data
}
```

### Profile Data Sources

The provider handles various Azure AD profile formats:

| MCP Field | Azure AD Sources (in priority order) |
|-----------|--------------------------------------|
| `id` | `id`, `oid` |
| `username` | `userPrincipalName`, `mail`, `email`, `preferred_username` |
| `email` | `mail`, `userPrincipalName`, `email` |
| `displayName` | `displayName`, `name` |
| `avatarUrl` | `photo` (Microsoft Graph photo endpoint) |

## Scopes and Permissions

### Default Scopes

The provider requests these scopes by default:

- `openid` - Required for OpenID Connect authentication
- `profile` - Access to basic profile information
- `email` - Access to user's email address
- `User.Read` - Read user profile from Microsoft Graph API

### Custom Scopes

You can request additional scopes by customizing the provider:

```typescript
const customAzureProvider = {
  ...AzureADOAuthProvider,
  scope: [
    'openid',
    'profile', 
    'email',
    'User.Read',
    'User.ReadWrite',        // Read and write user profile
    'Calendars.Read',        // Read user's calendars
    'Files.Read',            // Read user's files
    'Mail.Read',             // Read user's mail
  ],
};
```

### Microsoft Graph Permissions

For applications requiring access to Microsoft Graph APIs beyond basic profile:

1. In Azure Portal, go to your app registration
2. Navigate to **API permissions**
3. Add the required Microsoft Graph permissions
4. Grant admin consent if required by your organization

## Testing

### Unit Tests

```typescript
import { AzureADOAuthProvider } from '@rekog/mcp-nest/authz';

describe('Azure AD Provider', () => {
  it('should map profile correctly', () => {
    const azureProfile = {
      _json: {
        id: 'user-123',
        userPrincipalName: 'user@example.com',
        displayName: 'John Doe',
        mail: 'john@company.com',
      },
    };

    const mapped = AzureADOAuthProvider.profileMapper(azureProfile);
    
    expect(mapped).toEqual({
      id: 'user-123',
      username: 'user@example.com',
      email: 'john@company.com',
      displayName: 'John Doe',
      avatarUrl: undefined,
      raw: azureProfile,
    });
  });
});
```

### Integration Tests

Run the complete test suite:

```bash
npm test -- --testPathPattern=azure-ad
```

### Manual Testing

1. Start the server: `npm run start:azure-ad-oauth`
2. Visit the authorization URL in your browser
3. Complete the Azure AD login flow
4. Verify token exchange and MCP access

## Troubleshooting

### Common Issues

#### 1. "AADSTS50011: The reply address does not match"

**Cause:** Redirect URI mismatch between Azure AD app registration and your application.

**Solution:** 
- Check that the redirect URI in Azure AD matches exactly: `http://localhost:3000/auth/callback`
- Ensure no trailing slashes or extra parameters
- Use HTTPS in production environments

#### 2. "AADSTS700016: Application not found in directory"

**Cause:** Incorrect client ID or the app registration doesn't exist.

**Solution:**
- Verify the `AZURE_AD_CLIENT_ID` matches the Application ID from Azure Portal
- Ensure you're using the correct Azure AD tenant

#### 3. "AADSTS70002: Error validating credentials. AADSTS50012: Invalid client secret"

**Cause:** Incorrect or expired client secret.

**Solution:**
- Generate a new client secret in Azure Portal
- Update the `AZURE_AD_CLIENT_SECRET` environment variable
- Ensure the secret hasn't expired

#### 4. "AADSTS650053: The application is configured to use a scope that is not supported"

**Cause:** Invalid or unauthorized scopes requested.

**Solution:**
- Review the requested scopes in your configuration
- Ensure all scopes are supported by Microsoft Graph
- Grant necessary API permissions in Azure Portal

#### 5. Token validation errors

**Cause:** JWT token issues or expired tokens.

**Solution:**
- Check that your `JWT_SECRET` is at least 32 characters
- Verify token expiration settings
- Ensure server and client clocks are synchronized

### Debug Mode

Enable detailed logging for troubleshooting:

```typescript
McpAuthModule.forRoot({
  // ... other options
  storeConfiguration: {
    type: 'typeorm',
    options: {
      type: 'sqlite',
      database: 'oauth.db',
      synchronize: true,
      logging: true, // Enable SQL logging
    },
  },
})
```

### Support Resources

- [Azure AD Documentation](https://docs.microsoft.com/en-us/azure/active-directory/)
- [Microsoft Graph API](https://docs.microsoft.com/en-us/graph/)
- [OAuth 2.0 Specification](https://oauth.net/2/)
- [OpenID Connect](https://openid.net/connect/)

## Security Considerations

1. **Use HTTPS in production** - OAuth flows should never be transmitted over HTTP in production
2. **Secure client secrets** - Store client secrets in environment variables or secure vaults
3. **Validate redirect URIs** - Only register trusted redirect URIs in Azure AD
4. **Use strong JWT secrets** - Ensure JWT secrets are cryptographically strong (32+ characters)
5. **Implement proper token storage** - Use secure, encrypted storage for refresh tokens
6. **Regular secret rotation** - Rotate client secrets and JWT secrets periodically
7. **Monitor authentication logs** - Azure AD provides comprehensive logging for security monitoring

## Advanced Topics

### Multi-tenant Applications

For applications that support users from multiple Azure AD tenants:

```typescript
const multiTenantProvider = {
  ...AzureADOAuthProvider,
  strategyOptions: ({ serverUrl, clientId, clientSecret, callbackPath }) => ({
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: `${serverUrl}/${callbackPath}`,
    tenant: 'common', // Allows any tenant
    resource: 'https://graph.microsoft.com/',
  }),
};
```

### Custom Token Validation

Implement custom token validation logic:

```typescript
import { JwtAuthGuard } from '@rekog/mcp-nest/authz';

@Injectable()
export class CustomJwtGuard extends JwtAuthGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isValid = await super.canActivate(context);
    if (!isValid) return false;
    
    // Custom validation logic
    const user = context.switchToHttp().getRequest().user;
    return user.email.endsWith('@alloweddomain.com');
  }
}
```

This completes the comprehensive documentation for the Azure AD OAuth provider.
