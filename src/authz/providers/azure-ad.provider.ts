import { Strategy } from 'passport-azure-ad-oauth2';
import { normalizeEndpoint } from '../../mcp/utils/normalize-endpoint';
import { OAuthProviderConfig } from './oauth-provider.interface';

export const AzureADOAuthProvider: OAuthProviderConfig = {
  name: 'azure-ad',
  displayName: 'Microsoft Azure AD',
  strategy: Strategy,
  strategyOptions: ({ serverUrl, clientId, clientSecret, callbackPath }) => ({
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: normalizeEndpoint(`${serverUrl}/${callbackPath}`),
    tenant: 'common', // Can be overridden via custom configuration
    resource: 'https://graph.microsoft.com/', // Microsoft Graph API
  }),
  scope: ['openid', 'profile', 'email', 'User.Read'],
  profileMapper: (profile) => {
    // Azure AD profile structure from Microsoft Graph
    const azureProfile = profile._json || profile;
    
    return {
      id: azureProfile.id || azureProfile.oid || profile.id,
      username: azureProfile.preferred_username ||
                azureProfile.userPrincipalName || 
                azureProfile.mail || 
                azureProfile.email ||
                profile.username,
      email: azureProfile.mail || 
             azureProfile.userPrincipalName || 
             azureProfile.email ||
             profile.emails?.[0]?.value,
      displayName: azureProfile.displayName || 
                   azureProfile.name || 
                   profile.displayName,
      avatarUrl: azureProfile.photo || profile.photos?.[0]?.value,
      raw: profile,
    };
  },
};
