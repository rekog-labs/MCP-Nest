import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OAUTH_TYPEORM_CONNECTION_NAME } from './constants';
import { TypeOrmStore } from './typeorm-store.service';
import { EncryptionService } from '../../services/encryption.service';
import {
  OAuthClientEntity,
  AuthorizationCodeEntity,
  OAuthSessionEntity,
  OAuthUserProfileEntity,
} from './entities';

/**
 * Enhanced TypeORM store with optional AES-256 encryption support.
 *
 * This store extends the base TypeOrmStore and adds encryption capabilities
 * through entity transformers when an EncryptionService is provided.
 *
 * The encryption is handled transparently at the entity level,
 * so this store doesn't need additional encryption logic.
 */
@Injectable()
export class EncryptedTypeOrmStore extends TypeOrmStore {
  private readonly logger = new Logger(EncryptedTypeOrmStore.name);

  constructor(
    @InjectRepository(OAuthClientEntity, OAUTH_TYPEORM_CONNECTION_NAME)
    clientRepository: Repository<OAuthClientEntity>,
    @InjectRepository(AuthorizationCodeEntity, OAUTH_TYPEORM_CONNECTION_NAME)
    authCodeRepository: Repository<AuthorizationCodeEntity>,
    @InjectRepository(OAuthSessionEntity, OAUTH_TYPEORM_CONNECTION_NAME)
    sessionRepository: Repository<OAuthSessionEntity>,
    @InjectRepository(OAuthUserProfileEntity, OAUTH_TYPEORM_CONNECTION_NAME)
    userProfileRepository: Repository<OAuthUserProfileEntity>,
    @Optional() private readonly encryptionService?: EncryptionService,
  ) {
    // Pass repositories to parent class
    super(
      clientRepository,
      authCodeRepository,
      sessionRepository,
      userProfileRepository,
    );

    if (encryptionService?.isEnabled) {
      this.logger.log(
        `Encryption enabled with ${encryptionService.currentAlgorithm}`,
      );
    } else {
      this.logger.warn(
        'Encryption disabled - sensitive data will be stored in plaintext',
      );
    }
  }
}
