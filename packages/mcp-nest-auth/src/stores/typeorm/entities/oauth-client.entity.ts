import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OAUTH_TABLE_PREFIX } from '../constants';
import type { ClientApplicationType } from '../../../providers/oauth-provider.interface';

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

  /**
   * OIDC DCR `application_type` ('native' | 'web'), stored for auditing only —
   * this authorization server is not an OIDC provider and derives no behaviour
   * from it. Nullable because clients registered before revision `2026-07-28`
   * (and any non-MCP client) never sent it.
   *
   * Schema change: `synchronize: true` picks the column up automatically;
   * migration-managed deployments need an `ADD COLUMN application_type` on the
   * `rekog_mcp_auth_clients` table.
   */
  // `type: String` explicitly: a string-literal union reflects as `Object`, so
  // TypeORM cannot infer the column type from the property.
  @Column({ type: String, nullable: true })
  application_type?: ClientApplicationType;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
