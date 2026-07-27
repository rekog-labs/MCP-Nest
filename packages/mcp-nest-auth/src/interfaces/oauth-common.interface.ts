// Type-only import: `oauth-store.interface` imports back from here (via
// `oauth-provider.interface`), and `import type` is erased, so the cycle never
// exists at runtime.
import type { OAuthClient } from '../stores/oauth-store.interface';

export interface OAuthUserProfile {
  id: string;
  username: string;
  email?: string;
  displayName?: string;
  avatarUrl?: string;
  raw?: any; // Original profile data
}

export interface OAuthSession {
  sessionId: string;
  state: string;
  clientId?: string;
  redirectUri?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  oauthState?: string;
  scope?: string;
  resource?: string;
  expiresAt: number;

  /**
   * Set only while an interactive consent decision is outstanding. The IdP login
   * has already succeeded at this point, so the authenticated principal has to
   * survive until the user answers — `POST /consent` is a fresh request with no
   * passport state.
   */
  consentPending?: boolean;
  /** The authenticated user, recorded when consent is pending. */
  userId?: string;
  /** Stable `user_profile_id` for the same user, recorded when consent is pending. */
  userProfileId?: string;
  /**
   * The Client ID Metadata Document resolved at `/authorize`, for a CIMD client
   * only. Snapshotted (rather than re-fetched when the code is minted or
   * redeemed) so the grant is pinned to the metadata the user actually saw and
   * consented to — a document that changes mid-flow cannot retroactively widen
   * it.
   */
  clientMetadata?: OAuthClient;
}
