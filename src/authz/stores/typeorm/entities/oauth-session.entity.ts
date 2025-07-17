import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('oauth_sessions')
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

  @Column('bigint')
  expiresAt: number;

  @CreateDateColumn()
  created_at: Date;
}
