import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, createHash } from 'crypto';
import {
  OAuthClientEntity,
  AuthorizationCodeEntity,
  OAuthSessionEntity,
  OAuthUserProfileEntity,
} from './entities';
import { OAUTH_TYPEORM_CONNECTION_NAME } from './constants';
import type {
  OAuthSession,
  OAuthUserProfile,
} from '../../interfaces/oauth-common.interface';
import type {
  AuthorizationCode,
  IOAuthStore,
  OAuthClient,
} from '../oauth-store.interface';

@Injectable()
export class TypeOrmStore implements IOAuthStore {
  constructor(
    @InjectRepository(OAuthClientEntity, OAUTH_TYPEORM_CONNECTION_NAME)
    private readonly clientRepository: Repository<OAuthClientEntity>,
    @InjectRepository(AuthorizationCodeEntity, OAUTH_TYPEORM_CONNECTION_NAME)
    private readonly authCodeRepository: Repository<AuthorizationCodeEntity>,
    @InjectRepository(OAuthSessionEntity, OAUTH_TYPEORM_CONNECTION_NAME)
    private readonly sessionRepository: Repository<OAuthSessionEntity>,
    @InjectRepository(OAuthUserProfileEntity, OAUTH_TYPEORM_CONNECTION_NAME)
    private readonly userProfileRepository: Repository<OAuthUserProfileEntity>,
  ) {}

  // Client management
  async storeClient(client: OAuthClient): Promise<OAuthClient> {
    const savedClient = await this.clientRepository.save(client);
    return savedClient;
  }

  async getClient(client_id: string): Promise<OAuthClient | undefined> {
    return (
      (await this.clientRepository.findOne({ where: { client_id } })) ??
      undefined
    );
  }

  async findClient(client_name: string): Promise<OAuthClient | undefined> {
    return (
      (await this.clientRepository.findOne({ where: { client_name } })) ??
      undefined
    );
  }

  // Authorization code management
  async storeAuthCode(code: AuthorizationCode): Promise<void> {
    await this.authCodeRepository.save(code);
  }

  async getAuthCode(code: string): Promise<AuthorizationCode | undefined> {
    const authCode = await this.authCodeRepository.findOne({ where: { code } });
    // Check if expired
    if (authCode && authCode.expires_at < Date.now()) {
      await this.authCodeRepository.delete({ code });
      return undefined;
    }
    return authCode ?? undefined;
  }

  async removeAuthCode(code: string): Promise<void> {
    await this.authCodeRepository.delete({ code });
  }

  // OAuth session management
  async storeOAuthSession(
    sessionId: string,
    session: OAuthSession,
  ): Promise<void> {
    await this.sessionRepository.save({ ...session, sessionId });
  }

  async getOAuthSession(sessionId: string): Promise<OAuthSession | undefined> {
    const session = await this.sessionRepository.findOne({
      where: { sessionId },
    });
    if (session && session.expiresAt < Date.now()) {
      await this.sessionRepository.delete({ sessionId });
      return undefined;
    }
    return session ?? undefined;
  }

  async removeOAuthSession(sessionId: string): Promise<void> {
    await this.sessionRepository.delete({ sessionId });
  }

  generateClientId(client: OAuthClient): string {
    // Create deterministic client ID based on name + random salt
    const normalizedName = client.client_name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
    const salt = randomBytes(4).toString('hex');
    return `${normalizedName}_${salt}`;
  }

  // User profile management
  async upsertUserProfile(
    profile: OAuthUserProfile,
    provider: string,
  ): Promise<string> {
    // Try find by provider+provider_user_id
    const existing = await this.userProfileRepository.findOne({
      where: { provider, provider_user_id: profile.id },
    });
    if (existing) {
      // Update fields that may change
      existing.username = profile.username;
      existing.email = profile.email;
      existing.displayName = profile.displayName;
      existing.avatarUrl = profile.avatarUrl;
      existing.raw = profile.raw ? JSON.stringify(profile.raw) : existing.raw;
      await this.userProfileRepository.save(existing);
      return existing.profile_id;
    }
    // Create new
    const entity = this.userProfileRepository.create({
      profile_id: this.generateProfileId(provider, profile.id),
      provider_user_id: profile.id,
      provider,
      username: profile.username,
      email: profile.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      raw: profile.raw ? JSON.stringify(profile.raw) : undefined,
    });
    const saved = await this.userProfileRepository.save(entity);
    return saved.profile_id;
  }

  async getUserProfileById(
    profileId: string,
  ): Promise<
    (OAuthUserProfile & { profile_id: string; provider: string }) | undefined
  > {
    const entity = await this.userProfileRepository.findOne({
      where: { profile_id: profileId },
    });
    if (!entity) return undefined;
    return {
      profile_id: entity.profile_id,
      provider: entity.provider,
      id: entity.provider_user_id,
      username: entity.username,
      email: entity.email,
      displayName: entity.displayName,
      avatarUrl: entity.avatarUrl,
      raw: entity.raw ? JSON.parse(entity.raw) : undefined,
    };
  }

  private generateProfileId(provider: string, providerUserId: string): string {
    const input = `${provider}:${providerUserId}`;
    return createHash('sha256').update(input).digest('hex').slice(0, 24);
  }
}
