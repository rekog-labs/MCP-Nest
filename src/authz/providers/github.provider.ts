import { normalizeEndpoint } from '../../mcp/utils/normalize-endpoint';
import { OAuthProviderConfig } from './oauth-provider.interface';
import { Strategy } from 'passport-github';

export const GitHubOAuthProvider: OAuthProviderConfig = {
  name: 'github',
  strategy: Strategy,
  strategyOptions: ({ serverUrl, clientId, clientSecret, callbackPath }) => ({
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: normalizeEndpoint(`${serverUrl}/${callbackPath}`),
  }),
  scope: ['user:email'],
  profileMapper: (profile) => ({
    id: profile.id,
    username: profile.username || profile.login,
    email: profile.emails?.[0]?.value,
    displayName: profile.displayName || profile.name,
    avatarUrl: profile.photos?.[0]?.value || profile.avatar_url,
    raw: profile,
  }),
};
