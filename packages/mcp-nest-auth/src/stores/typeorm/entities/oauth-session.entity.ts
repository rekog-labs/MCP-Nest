import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';
import { OAUTH_TABLE_PREFIX } from '../constants';

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

  @CreateDateColumn()
  created_at: Date;
}
