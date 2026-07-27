import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';
import { OAUTH_TABLE_PREFIX } from '../constants';
import type { OAuthClient } from '../../oauth-store.interface';

@Entity(`${OAUTH_TABLE_PREFIX}authorization_codes`)
export class AuthorizationCodeEntity {
  @PrimaryColumn()
  code: string;

  @Column()
  user_id: string;

  @Column()
  client_id: string;

  @Column()
  redirect_uri: string;

  @Column()
  code_challenge: string;

  @Column()
  code_challenge_method: string;

  @Column('bigint')
  expires_at: number;

  @Column()
  resource: string;

  @Column({ nullable: true })
  scope?: string;

  @Column({ nullable: true })
  used_at?: Date;

  @Column({ nullable: true })
  user_profile_id?: string;

  // The Client ID Metadata Document this code is pinned to, for a CIMD client.
  // See `AuthorizationCode.client_metadata`.
  @Column('simple-json', { nullable: true })
  client_metadata?: OAuthClient;

  @CreateDateColumn()
  created_at: Date;
}
