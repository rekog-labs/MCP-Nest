import { EncryptionService } from '../src/authz/services/encryption.service';

describe('EncryptionService', () => {
  describe('AES-256-GCM', () => {
    let encryptionService: EncryptionService;

    beforeEach(() => {
      encryptionService = new EncryptionService({
        encryptionKey: EncryptionService.generateKey(),
        algorithm: 'aes-256-gcm',
      });
    });

    it('should encrypt and decrypt data correctly', () => {
      const plaintext = 'sensitive user data';

      const encrypted = encryptionService.encrypt(plaintext);
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted!.split(':').length).toBe(3); // iv:authTag:data format for GCM

      const decrypted = encryptionService.decrypt(encrypted!);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle null and undefined values', () => {
      expect(encryptionService.encrypt(null)).toBeNull();
      expect(encryptionService.encrypt(undefined)).toBeUndefined();
      expect(encryptionService.decrypt(null)).toBeNull();
      expect(encryptionService.decrypt(undefined)).toBeUndefined();
    });

    it('should encrypt the same data differently each time (due to random IV)', () => {
      const plaintext = 'same data';

      const encrypted1 = encryptionService.encrypt(plaintext);
      const encrypted2 = encryptionService.encrypt(plaintext);

      expect(encrypted1).not.toBe(encrypted2);

      const decrypted1 = encryptionService.decrypt(encrypted1!);
      const decrypted2 = encryptionService.decrypt(encrypted2!);

      expect(decrypted1).toBe(plaintext);
      expect(decrypted2).toBe(plaintext);
    });

    it('should handle empty strings', () => {
      const plaintext = '';

      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted!);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle special characters and unicode', () => {
      const plaintext = 'Special chars: äöü 中文 🔐 emoji';

      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted!);

      expect(decrypted).toBe(plaintext);
    });

    it('should handle long strings', () => {
      const plaintext = 'A'.repeat(10000);

      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted!);

      expect(decrypted).toBe(plaintext);
    });

    it('should report encryption status correctly', () => {
      expect(encryptionService.isEnabled).toBe(true);
      expect(encryptionService.currentAlgorithm).toBe('aes-256-gcm');
    });
  });

  describe('AES-256-CBC', () => {
    let encryptionService: EncryptionService;

    beforeEach(() => {
      encryptionService = new EncryptionService({
        encryptionKey: EncryptionService.generateKey(),
        algorithm: 'aes-256-cbc',
      });
    });

    it('should encrypt and decrypt data correctly', () => {
      const plaintext = 'sensitive user data';

      const encrypted = encryptionService.encrypt(plaintext);
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(plaintext);
      expect(encrypted!.split(':').length).toBe(2); // iv:data format for CBC

      const decrypted = encryptionService.decrypt(encrypted!);
      expect(decrypted).toBe(plaintext);
    });

    it('should report encryption status correctly', () => {
      expect(encryptionService.isEnabled).toBe(true);
      expect(encryptionService.currentAlgorithm).toBe('aes-256-cbc');
    });
  });

  describe('Key Derivation', () => {
    it('should derive keys from password using scrypt', () => {
      const password = 'my-strong-password';

      const service1 = new EncryptionService({
        encryptionKey: password,
        useKeyDerivation: true,
        algorithm: 'aes-256-gcm',
      });

      const service2 = new EncryptionService({
        encryptionKey: password,
        useKeyDerivation: true,
        algorithm: 'aes-256-gcm',
      });

      const plaintext = 'test data';

      // Both services should be able to encrypt/decrypt each other's data
      const encrypted1 = service1.encrypt(plaintext);
      const decrypted2 = service2.decrypt(encrypted1!);

      expect(decrypted2).toBe(plaintext);
    });
  });

  describe('Disabled Encryption', () => {
    let encryptionService: EncryptionService;

    beforeEach(() => {
      encryptionService = new EncryptionService(); // No encryption key
    });

    it('should pass through data unchanged when encryption is disabled', () => {
      const plaintext = 'not encrypted data';

      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(plaintext);

      expect(encrypted).toBe(plaintext);
      expect(decrypted).toBe(plaintext);
    });

    it('should report encryption status correctly', () => {
      expect(encryptionService.isEnabled).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should throw error for invalid key length', () => {
      expect(() => {
        new EncryptionService({
          encryptionKey: 'too-short-key',
          algorithm: 'aes-256-gcm',
        });
      }).toThrow('Encryption key must be exactly 64 hex characters');
    });

    it('should handle malformed ciphertext gracefully', () => {
      const encryptionService = new EncryptionService({
        encryptionKey: EncryptionService.generateKey(),
        algorithm: 'aes-256-gcm',
      });

      // Should return original value for invalid ciphertext (might be legacy data)
      const malformedCiphertext = 'not-a-valid-ciphertext';
      const result = encryptionService.decrypt(malformedCiphertext);
      expect(result).toBe(malformedCiphertext);
    });

    it('should handle invalid GCM format gracefully', () => {
      const encryptionService = new EncryptionService({
        encryptionKey: EncryptionService.generateKey(),
        algorithm: 'aes-256-gcm',
      });

      // Invalid format (should have 3 parts for GCM)
      const invalidFormat = 'part1:part2';
      const result = encryptionService.decrypt(invalidFormat);
      expect(result).toBe(invalidFormat); // Should return original
    });

    it('should handle invalid CBC format gracefully', () => {
      const encryptionService = new EncryptionService({
        encryptionKey: EncryptionService.generateKey(),
        algorithm: 'aes-256-cbc',
      });

      // Invalid format (should have 2 parts for CBC)
      const invalidFormat = 'part1:part2:part3';
      const result = encryptionService.decrypt(invalidFormat);
      expect(result).toBe(invalidFormat); // Should return original
    });
  });

  describe('Key Generation', () => {
    it('should generate valid encryption keys', () => {
      const key1 = EncryptionService.generateKey();
      const key2 = EncryptionService.generateKey();

      expect(key1).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(key2).toHaveLength(64);
      expect(key1).not.toBe(key2); // Should be random

      // Should be valid hex
      expect(/^[0-9a-f]{64}$/i.test(key1)).toBe(true);
      expect(/^[0-9a-f]{64}$/i.test(key2)).toBe(true);
    });

    it('should generate keys that work with encryption service', () => {
      const key = EncryptionService.generateKey();
      const encryptionService = new EncryptionService({
        encryptionKey: key,
        algorithm: 'aes-256-gcm',
      });

      const plaintext = 'test with generated key';
      const encrypted = encryptionService.encrypt(plaintext);
      const decrypted = encryptionService.decrypt(encrypted!);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe('Cross-Algorithm Compatibility', () => {
    it('should not be able to decrypt data encrypted with different algorithm', () => {
      const key = EncryptionService.generateKey();
      const plaintext = 'test data';

      const gcmService = new EncryptionService({
        encryptionKey: key,
        algorithm: 'aes-256-gcm',
      });

      const cbcService = new EncryptionService({
        encryptionKey: key,
        algorithm: 'aes-256-cbc',
      });

      const gcmEncrypted = gcmService.encrypt(plaintext);
      const cbcEncrypted = cbcService.encrypt(plaintext);

      // Different algorithms should produce different formats
      expect(gcmEncrypted!.split(':').length).toBe(3); // GCM: iv:authTag:data
      expect(cbcEncrypted!.split(':').length).toBe(2); // CBC: iv:data

      // Cross-decryption should fail gracefully (return original)
      const gcmToCbc = cbcService.decrypt(gcmEncrypted!);
      const cbcToGcm = gcmService.decrypt(cbcEncrypted!);

      expect(gcmToCbc).toBe(gcmEncrypted); // Should return original on failure
      expect(cbcToGcm).toBe(cbcEncrypted); // Should return original on failure
    });
  });
});
