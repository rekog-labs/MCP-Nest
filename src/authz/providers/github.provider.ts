import { OAuthProviderConfig } from './oauth-provider.interface';

// Note: You'll need to install passport-github2
// npm install passport-github2 @types/passport-github2

export const GitHubOAuthProvider: OAuthProviderConfig = {
  name: 'github',
  displayName: 'GitHub',
  strategy: require('passport-github').Strategy,
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
