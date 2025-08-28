import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'crypto';

export interface EncryptionOptions {
  /**
   * Encryption key (32 bytes for AES-256).
   * If not provided, encryption will be disabled.
   */
  encryptionKey?: string;

  /**
   * Algorithm to use for encryption. Defaults to 'aes-256-gcm'
   */
  algorithm?: 'aes-256-gcm' | 'aes-256-cbc';

  /**
   * Whether to use key derivation from a password instead of raw key.
   * If true, encryptionKey will be treated as a password.
   */
  useKeyDerivation?: boolean;
}

/**
 * Service for encrypting and decrypting sensitive data using AES-256.
 * This service is flexible and optional - if no encryption key is provided,
 * it will operate in pass-through mode (no encryption).
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);

  private encryptionKey?: Buffer;
  private readonly algorithm: 'aes-256-gcm' | 'aes-256-cbc';
  private readonly isEncryptionEnabled: boolean;

  constructor(private readonly options: EncryptionOptions = {}) {
    this.algorithm = options.algorithm || 'aes-256-gcm';
    this.isEncryptionEnabled = !!options.encryptionKey;

    if (this.isEncryptionEnabled && options.encryptionKey) {
      try {
        if (options.useKeyDerivation) {
          // For key derivation, we'll do it synchronously using scryptSync
          const salt = createHash('sha256')
            .update('mcp-nest-oauth-salt')
            .digest();
          this.encryptionKey = require('crypto').scryptSync(
            options.encryptionKey,
            salt,
            32,
          );
          this.logger.log('Encryption key derived from password using scrypt');
        } else {
          // Use raw key (must be exactly 32 bytes for AES-256)
          if (options.encryptionKey.length !== 64) {
            // 32 bytes = 64 hex chars
            throw new Error(
              'Encryption key must be exactly 64 hex characters (32 bytes) for AES-256',
            );
          }
          this.encryptionKey = Buffer.from(options.encryptionKey, 'hex');
          this.logger.log('Raw encryption key loaded');
        }
        this.logger.log(
          `AES-256 encryption initialized with algorithm: ${this.algorithm}`,
        );
      } catch (error) {
        this.logger.error('Failed to initialize encryption key', error);
        throw new Error(
          `Encryption initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
      }
    } else {
      this.logger.warn(
        'No encryption key provided. Sensitive data will be stored in plaintext. ' +
          'For production use, provide an encryptionKey in the store configuration.',
      );
    }
  }

  /**
   * Encrypt a string value. Returns the original value if encryption is disabled.
   */
  encrypt(plaintext: string | null | undefined): string | null | undefined {
    if (!plaintext || !this.isEncryptionEnabled || !this.encryptionKey) {
      return plaintext;
    }

    try {
      if (this.algorithm === 'aes-256-gcm') {
        return this.encryptGCM(plaintext);
      } else {
        return this.encryptCBC(plaintext);
      }
    } catch (error) {
      this.logger.error('Encryption failed', error);
      throw new Error(
        `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Decrypt a string value. Returns the original value if encryption is disabled.
   */
  decrypt(ciphertext: string | null | undefined): string | null | undefined {
    if (!ciphertext || !this.isEncryptionEnabled || !this.encryptionKey) {
      return ciphertext;
    }

    try {
      if (this.algorithm === 'aes-256-gcm') {
        return this.decryptGCM(ciphertext);
      } else {
        return this.decryptCBC(ciphertext);
      }
    } catch (error) {
      this.logger.error('Decryption failed', error);
      // In case of decryption failure, we might be dealing with legacy unencrypted data
      // Return the original value but log the warning
      this.logger.warn(
        'Decryption failed, returning original value (might be legacy unencrypted data)',
      );
      return ciphertext;
    }
  }

  /**
   * Encrypt using AES-256-GCM (provides both confidentiality and integrity)
   */
  private encryptGCM(plaintext: string): string {
    const iv = randomBytes(16); // 128-bit IV for GCM
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey!, iv);
    cipher.setAAD(Buffer.from('mcp-nest-oauth', 'utf8')); // Additional authenticated data

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:encryptedData (all hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt using AES-256-GCM
   */
  private decryptGCM(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format for GCM');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey!, iv);
    decipher.setAAD(Buffer.from('mcp-nest-oauth', 'utf8'));
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Encrypt using AES-256-CBC (traditional block cipher)
   */
  private encryptCBC(plaintext: string): string {
    const iv = randomBytes(16); // 128-bit IV
    const cipher = createCipheriv('aes-256-cbc', this.encryptionKey!, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Format: iv:encryptedData (both hex)
    return `${iv.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt using AES-256-CBC
   */
  private decryptCBC(ciphertext: string): string {
    const parts = ciphertext.split(':');
    if (parts.length !== 2) {
      throw new Error('Invalid ciphertext format for CBC');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];

    const decipher = createDecipheriv('aes-256-cbc', this.encryptionKey!, iv);

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Check if encryption is enabled
   */
  get isEnabled(): boolean {
    return this.isEncryptionEnabled;
  }

  /**
   * Get the algorithm being used
   */
  get currentAlgorithm(): string {
    return this.algorithm;
  }

  /**
   * Generate a random encryption key for AES-256 (64 hex characters)
   */
  static generateKey(): string {
    return randomBytes(32).toString('hex');
  }
}
