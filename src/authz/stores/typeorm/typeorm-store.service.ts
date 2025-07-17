import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import {
  OAuthClientEntity,
  AuthorizationCodeEntity,
  OAuthSessionEntity,
} from './entities';
import { OAuthSession } from '../../providers/oauth-provider.interface';
import {
  AuthorizationCode,
  IOAuthStore,
  OAuthClient,
} from '../oauth-store.interface';

@Injectable()
export class TypeOrmStore implements IOAuthStore {
  constructor(
    @InjectRepository(OAuthClientEntity)
    private readonly clientRepository: Repository<OAuthClientEntity>,
    @InjectRepository(AuthorizationCodeEntity)
    private readonly authCodeRepository: Repository<AuthorizationCodeEntity>,
    @InjectRepository(OAuthSessionEntity)
    private readonly sessionRepository: Repository<OAuthSessionEntity>,
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
}
