import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';
import { OAUTH_TABLE_PREFIX } from '../constants';

@Entity(`${OAUTH_TABLE_PREFIX}sessions`)
export class OAuthSessionEntity {
  @PrimaryColumn()
  sessionId: string;

  // Sensitive: Session state - can be encrypted if transformer is provided
  @Column()
  state: string;

  @Column({ nullable: true })
  clientId?: string;

  @Column({ nullable: true })
  redirectUri?: string;

  // Sensitive: PKCE challenge - can be encrypted if transformer is provided
  @Column({ nullable: true })
  codeChallenge?: string;

  @Column({ nullable: true })
  codeChallengeMethod?: string;

  // Sensitive: OAuth state - can be encrypted if transformer is provided
  @Column({ nullable: true })
  oauthState?: string;

  @Column({ nullable: true })
  resource?: string;

  @Column({ nullable: true })
  scope?: string;

  @Column('bigint')
  expiresAt: number;

  @CreateDateColumn()
  created_at: Date;
}
