import { Entity, Column, PrimaryColumn, CreateDateColumn } from 'typeorm';

@Entity('authorization_codes')
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

  @Column({ nullable: true })
  used_at?: Date;

  @Column()
  github_access_token: string;

  @CreateDateColumn()
  created_at: Date;
}
