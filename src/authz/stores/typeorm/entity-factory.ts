import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { OAUTH_TABLE_PREFIX } from './constants';
import { EncryptionService } from '../../services/encryption.service';
import {
  createEncryptionTransformer,
  createJsonEncryptionTransformer,
} from './transformers';

/**
 * Factory function to create encrypted OAuth entities.
 * If encryptionService is provided, sensitive fields will be encrypted.
 * If not, entities will work normally without encryption.
 */
export function createOAuthEntities(encryptionService?: EncryptionService) {
  // Create transformers if encryption is enabled
  const encryptTransformer = encryptionService
    ? createEncryptionTransformer(encryptionService)
    : undefined;
  const jsonEncryptTransformer = encryptionService
    ? createJsonEncryptionTransformer(encryptionService)
    : undefined;

  @Entity(`${OAUTH_TABLE_PREFIX}clients`)
  class OAuthClientEntity {
    @PrimaryColumn()
    client_id: string;

    // Sensitive: Client secret should be encrypted
    @Column({
      nullable: true,
      transformer: encryptTransformer,
    })
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

    // Potentially sensitive: Email should be encrypted
    @Column({
      nullable: true,
      transformer: encryptTransformer,
    })
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

  @Entity(`${OAUTH_TABLE_PREFIX}authorization_codes`)
  class AuthorizationCodeEntity {
    @PrimaryColumn()
    code: string;

    // Sensitive: User ID should be encrypted
    @Column({
      transformer: encryptTransformer,
    })
    user_id: string;

    @Column()
    client_id: string;

    @Column()
    redirect_uri: string;

    // Sensitive: PKCE challenge should be encrypted
    @Column({
      transformer: encryptTransformer,
    })
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

    // Highly sensitive: Access token should be encrypted
    @Column({
      transformer: encryptTransformer,
    })
    github_access_token: string;

    @Column({
      nullable: true,
      transformer: encryptTransformer,
    })
    user_profile_id?: string;

    @CreateDateColumn()
    created_at: Date;
  }

  @Entity(`${OAUTH_TABLE_PREFIX}sessions`)
  class OAuthSessionEntity {
    @PrimaryColumn()
    sessionId: string;

    // Sensitive: Session state should be encrypted
    @Column({
      transformer: encryptTransformer,
    })
    state: string;

    @Column({ nullable: true })
    clientId?: string;

    @Column({ nullable: true })
    redirectUri?: string;

    // Sensitive: PKCE challenge should be encrypted
    @Column({
      nullable: true,
      transformer: encryptTransformer,
    })
    codeChallenge?: string;

    @Column({ nullable: true })
    codeChallengeMethod?: string;

    // Sensitive: OAuth state should be encrypted
    @Column({
      nullable: true,
      transformer: encryptTransformer,
    })
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

  @Entity(`${OAUTH_TABLE_PREFIX}user_profiles`)
  class OAuthUserProfileEntity {
    // Stable profile id we return to callers
    @PrimaryColumn()
    profile_id: string;

    // Provider-unique user id - keep unencrypted for indexing
    @Index('idx_provider_user')
    @Column()
    provider_user_id: string;

    @Column()
    provider: string;

    // Potentially sensitive: Username should be encrypted
    @Column({
      transformer: encryptTransformer,
    })
    username: string;

    // Sensitive: Email should be encrypted
    @Column({
      nullable: true,
      transformer: encryptTransformer,
    })
    email?: string;

    // Potentially sensitive: Display name should be encrypted
    @Column({
      nullable: true,
      transformer: encryptTransformer,
    })
    displayName?: string;

    @Column({ nullable: true })
    avatarUrl?: string;

    // Highly sensitive: Raw profile data should be encrypted
    @Column({
      type: 'text',
      nullable: true,
      transformer: jsonEncryptTransformer,
    })
    raw?: string;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;
  }

  return {
    OAuthClientEntity,
    AuthorizationCodeEntity,
    OAuthSessionEntity,
    OAuthUserProfileEntity,
  };
}
