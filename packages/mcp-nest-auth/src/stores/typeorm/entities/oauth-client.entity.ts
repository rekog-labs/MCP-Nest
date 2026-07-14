import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OAUTH_TABLE_PREFIX } from '../constants';

@Entity(`${OAUTH_TABLE_PREFIX}clients`)
export class OAuthClientEntity {
  @PrimaryColumn()
  client_id: string;

  @Column({ nullable: true })
  client_secret?: string;

  @Column()
  client_name: string;

  @Column({ nullable: true })
  client_description?: string;

  @Column({ nullable: true })
  logo_uri?: string;

  @Column({ nullable: true })
  client_uri?: string;

  @Column({ nullable: true })
  developer_name?: string;

  @Column({ nullable: true })
  developer_email?: string;

  @Column('simple-array')
  redirect_uris: string[];

  @Column('simple-array')
  grant_types: string[];

  @Column('simple-array')
  response_types: string[];

  @Column()
  token_endpoint_auth_method: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
