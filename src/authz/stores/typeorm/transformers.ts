import { ValueTransformer } from 'typeorm';
import { EncryptionService } from '../../services/encryption.service';

/**
 * TypeORM column transformer that automatically encrypts/decrypts string values
 * using the provided EncryptionService.
 *
 * Usage in entity:
 * @Column({
 *   transformer: createEncryptionTransformer(encryptionService)
 * })
 * sensitiveField: string;
 */
export function createEncryptionTransformer(
  encryptionService: EncryptionService,
): ValueTransformer {
  return {
    /**
     * Transforms value when writing to database (encrypt)
     */
    to: (plaintext: string | null | undefined): string | null | undefined => {
      return encryptionService.encrypt(plaintext);
    },

    /**
     * Transforms value when reading from database (decrypt)
     */
    from: (
      ciphertext: string | null | undefined,
    ): string | null | undefined => {
      return encryptionService.decrypt(ciphertext);
    },
  };
}

/**
 * TypeORM column transformer for JSON fields that need encryption.
 * This transformer handles JSON stringify/parse operations along with encryption.
 *
 * Usage in entity:
 * @Column({
 *   type: 'text',
 *   transformer: createJsonEncryptionTransformer(encryptionService)
 * })
 * sensitiveJsonField: any;
 */
export function createJsonEncryptionTransformer(
  encryptionService: EncryptionService,
): ValueTransformer {
  return {
    /**
     * Transforms JSON object to encrypted string for database storage
     */
    to: (jsonValue: any): string | null | undefined => {
      if (jsonValue === null || jsonValue === undefined) {
        return jsonValue;
      }
      const jsonString = JSON.stringify(jsonValue);
      return encryptionService.encrypt(jsonString);
    },

    /**
     * Transforms encrypted string from database to JSON object
     */
    from: (ciphertext: string | null | undefined): any => {
      if (!ciphertext) {
        return ciphertext;
      }

      try {
        const decrypted = encryptionService.decrypt(ciphertext);
        return decrypted ? JSON.parse(decrypted) : decrypted;
      } catch (error) {
        // If decryption fails, it might be legacy unencrypted JSON data
        // Try parsing the original value
        try {
          return JSON.parse(ciphertext);
        } catch {
          // If both decryption and direct parsing fail, return null
          return null;
        }
      }
    },
  };
}
