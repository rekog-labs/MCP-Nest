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

  // Provider-unique user id (e.g., GitHub id)
  @Index('idx_provider_user')
  @Column()
  provider_user_id: string;

  @Column()
  provider: string;

  @Column()
  username: string;

  @Column({ nullable: true })
  email?: string;

  @Column({ nullable: true })
  displayName?: string;

  @Column({ nullable: true })
  avatarUrl?: string;

  // Store raw provider profile for completeness/debugging
  @Column({ type: 'text', nullable: true })
  raw?: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
