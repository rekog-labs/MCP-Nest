import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { OAUTH_TABLE_PREFIX } from '../constants';

@Entity(`${OAUTH_TABLE_PREFIX}user_profiles`)
export class OAuthUserProfileEntity {
  // Stable profile id we return to callers
  @PrimaryColumn()
  profile_id: string;

  // Provider-unique user id (e.g., GitHub id) - keep unencrypted for indexing
  @Index('idx_provider_user')
  @Column()
  provider_user_id: string;

  @Column()
  provider: string;

  // Potentially sensitive: Username - can be encrypted if transformer is provided
  @Column()
  username: string;

  // Sensitive: Email - can be encrypted if transformer is provided
  @Column({ nullable: true })
  email?: string;

  // Potentially sensitive: Display name - can be encrypted if transformer is provided
  @Column({ nullable: true })
  displayName?: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  // Highly sensitive: Raw profile data - can be encrypted if transformer is provided
  // Store raw provider profile for completeness/debugging
  @Column({ type: 'text', nullable: true })
  raw?: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
