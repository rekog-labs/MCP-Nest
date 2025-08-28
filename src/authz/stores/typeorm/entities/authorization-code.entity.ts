import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';
import { OAUTH_TABLE_PREFIX } from '../constants';

@Entity(`${OAUTH_TABLE_PREFIX}authorization_codes`)
export class AuthorizationCodeEntity {
  @PrimaryColumn()
  code: string;

  // Sensitive: User ID - can be encrypted if transformer is provided
  @Column()
  user_id: string;

  @Column()
  client_id: string;

  @Column()
  redirect_uri: string;

  // Sensitive: PKCE challenge - can be encrypted if transformer is provided
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

  // Highly sensitive: Access token - can be encrypted if transformer is provided
  @Column()
  github_access_token: string;

  @Column({ nullable: true })
  user_profile_id?: string;

  @CreateDateColumn()
  created_at: Date;
}
