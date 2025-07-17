import { OAuthProviderConfig } from './oauth-provider.interface';
import { Strategy } from 'passport-google-oauth20';

export const GoogleOAuthProvider: OAuthProviderConfig = {
  name: 'google',
  strategy: Strategy,
  strategyOptions: ({ serverUrl, clientId, clientSecret }) => ({
    clientID: clientId,
    clientSecret: clientSecret,
    callbackURL: `${serverUrl}/auth/callback`,
    scope: ['profile', 'email'],
  }),
  scope: ['profile', 'email'],
  profileMapper: (profile) => ({
    id: profile.id,
    username: profile.emails?.[0]?.value?.split('@')[0] || profile.id,
    email: profile.emails?.[0]?.value,
    displayName: profile.displayName,
    avatarUrl: profile.photos?.[0]?.value,
    raw: profile,
  }),
};
