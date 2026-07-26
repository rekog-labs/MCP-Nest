import { normalizeEndpoint } from '@rekog/mcp-nest';
import type { OAuthProviderConfig } from '@rekog/mcp-nest-auth';

/**
 * A **fake, local, offline** identity provider.
 *
 * FAKE-MODE ONLY. It performs no authentication whatsoever: every visitor is
 * "Ada Lovelace". It exists so the interactive browser leg
 * (`/auth/authorize` → IdP → `/auth/callback`) can actually be walked through
 * on a laptop with no GitHub App and no network — which is what makes the
 * consent screen and Client ID Metadata Documents demonstrable at all. The real
 * `GitHubOAuthProvider` is still what `main.ts` wires by default.
 *
 * The shape is a plain passport strategy, so nothing in `McpAuthModule` knows
 * this is fake: `OAuthStrategyService` constructs it and calls `authenticate()`
 * exactly as it would `passport-github`. On the outbound leg a real IdP would
 * redirect to its own consent/login page and eventually back to our callback;
 * here we redirect straight back, so the redirect round-trip (and therefore the
 * cookies, the `state` and the session lookup) is genuinely exercised.
 */
export const LocalFakeIdpProvider: OAuthProviderConfig = {
  name: 'local-fake-idp',
  displayName: 'Local Fake IdP (offline)',
  strategy: class LocalFakeIdpStrategy {
    name = 'local-fake-idp';
    callbackURL: string;
    _verify: (
      accessToken: string,
      refreshToken: string,
      profile: unknown,
      done: (err: unknown, user?: unknown) => void,
    ) => void;

    constructor(options: { callbackURL: string }, verify: any) {
      this.callbackURL = options.callbackURL;
      this._verify = verify;
    }

    authenticate(this: any, req: { url?: string }) {
      const isCallback = String(req.url ?? '').includes('/callback');

      if (!isCallback) {
        // Stand in for the provider's own login page: bounce straight back.
        const target = new URL(this.callbackURL);
        target.searchParams.set('code', 'fake-idp-authorization-code');
        this.redirect(target.toString());
        return;
      }

      this._verify(
        'fake-provider-access-token',
        'fake-provider-refresh-token',
        {
          id: 'ada-1815',
          username: 'ada',
          displayName: 'Ada Lovelace',
          emails: [{ value: 'ada@example.com' }],
        },
        (err: unknown, user: unknown) =>
          err ? this.error(err) : this.success(user),
      );
    }
  },
  strategyOptions: ({ serverUrl, callbackPath }) => ({
    callbackURL: normalizeEndpoint(`${serverUrl}/${callbackPath}`),
  }),
  profileMapper: (profile: any) => ({
    id: profile.id,
    username: profile.username,
    email: profile.emails?.[0]?.value,
    displayName: profile.displayName,
  }),
};
