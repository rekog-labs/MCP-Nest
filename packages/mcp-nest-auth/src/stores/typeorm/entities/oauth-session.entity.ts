import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';
import { OAUTH_TABLE_PREFIX } from '../constants';
import type { OAuthClient } from '../../oauth-store.interface';

@Entity(`${OAUTH_TABLE_PREFIX}sessions`)
export class OAuthSessionEntity {
  @PrimaryColumn()
  sessionId: string;

  @Column()
  state: string;

  @Column({ nullable: true })
  clientId?: string;

  @Column({ nullable: true })
  redirectUri?: string;

  @Column({ nullable: true })
  codeChallenge?: string;

  @Column({ nullable: true })
  codeChallengeMethod?: string;

  @Column({ nullable: true })
  oauthState?: string;

  @Column({ nullable: true })
  resource?: string;

  @Column({ nullable: true })
  scope?: string;

  @Column('bigint')
  expiresAt: number;

  // Set only between the IdP callback and the user's consent decision; see the
  // notes on `OAuthSession`.
  @Column({ nullable: true })
  consentPending?: boolean;

  @Column({ nullable: true })
  userId?: string;

  @Column({ nullable: true })
  userProfileId?: string;

  // The Client ID Metadata Document snapshot for a CIMD client. `simple-json`
  // rather than a relation: it is an immutable copy of a remote document, not a
  // registration this server owns.
  @Column('simple-json', { nullable: true })
  clientMetadata?: OAuthClient;

  @CreateDateColumn()
  created_at: Date;
}
