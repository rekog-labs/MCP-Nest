import { OAuthProviderConfig } from './oauth-provider.interface';
import { Strategy } from 'passport-github';

// Note: You'll need to install passport-github
// npm install passport-github @types/passport-github

export const GitHubOAuthProvider: OAuthProviderConfig = {
  name: 'github',
  strategy: Strategy,
  strategyOptions: ({ serverUrl, clientId, clientSecret }) => ({
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: `${serverUrl}/auth/callback`,
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
