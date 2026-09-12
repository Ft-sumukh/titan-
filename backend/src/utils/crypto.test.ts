import { describe, it, expect } from 'vitest';
import {
  computeHmacSha256,
  verifyHmacSignature,
  isTimestampValid,
  computeAlertFingerprint,
  encryptAes256Gcm,
  decryptAes256Gcm,
} from './crypto.js';

describe('Crypto Utilities', () => {
  const secret = 'test-secret-key-12345678901234567890';

  describe('HMAC-SHA256 Verification', () => {
    it('should compute and verify valid signature', () => {
      const payload = JSON.stringify({ message: 'critical alert' });
      const signature = computeHmacSha256(payload, secret);

      expect(verifyHmacSignature(payload, signature, secret)).toBe(true);
      expect(verifyHmacSignature(payload, `sha256=${signature}`, secret)).toBe(true);
    });

    it('should reject tampered payload', () => {
      const payload = JSON.stringify({ message: 'critical alert' });
      const signature = computeHmacSha256(payload, secret);
      const tamperedPayload = JSON.stringify({ message: 'critical alert tampered' });

      expect(verifyHmacSignature(tamperedPayload, signature, secret)).toBe(false);
    });

    it('should reject incorrect signature length safely without error', () => {
      const payload = JSON.stringify({ message: 'alert' });
      expect(verifyHmacSignature(payload, 'short-sig', secret)).toBe(false);
      expect(verifyHmacSignature(payload, '', secret)).toBe(false);
    });
  });

  describe('Replay Protection Timestamp Validation', () => {
    it('should accept recent timestamps within drift window', () => {
      const now = new Date().toISOString();
      const check = isTimestampValid(now, 300);
      expect(check.valid).toBe(true);

      const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
      expect(isTimestampValid(fiveSecondsAgo, 300).valid).toBe(true);
    });

    it('should reject timestamps older than tolerance window', () => {
      const tenMinutesAgo = new Date(Date.now() - 600 * 1000).toISOString();
      const check = isTimestampValid(tenMinutesAgo, 300);
      expect(check.valid).toBe(false);
      expect(check.reason).toContain('exceeds allowed tolerance');
    });

    it('should reject future timestamps with large drift', () => {
      const futureTimestamp = new Date(Date.now() + 600 * 1000).toISOString();
      const check = isTimestampValid(futureTimestamp, 300);
      expect(check.valid).toBe(false);
    });

    it('should reject malformed timestamps', () => {
      const check = isTimestampValid('not-a-valid-date');
      expect(check.valid).toBe(false);
      expect(check.reason).toContain('Invalid timestamp');
    });
  });

  describe('Deterministic Fingerprinting', () => {
    it('should generate identical SHA-256 hash for identical alert dimensions', () => {
      const inputA = {
        source: 'prometheus',
        service: 'checkout',
        environment: 'production',
        alertName: 'HighCPU',
        cluster: 'us-east-1',
      };

      const inputB = {
        source: 'PROMETHEUS ',
        service: ' CHECKOUT',
        environment: 'PRODUCTION',
        alertName: 'highcpu',
        cluster: 'us-east-1 ',
      };

      const hashA = computeAlertFingerprint(inputA);
      const hashB = computeAlertFingerprint(inputB);

      expect(hashA).toHaveLength(64);
      expect(hashA).toBe(hashB);
    });

    it('should generate distinct hashes for different services', () => {
      const hash1 = computeAlertFingerprint({
        source: 'prometheus',
        service: 'payments',
        environment: 'prod',
        alertName: 'Timeout',
      });

      const hash2 = computeAlertFingerprint({
        source: 'prometheus',
        service: 'auth',
        environment: 'prod',
        alertName: 'Timeout',
      });

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('AES-256-GCM Envelope Encryption', () => {
    const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    it('should encrypt and decrypt plaintext accurately', () => {
      const plaintext = 'api_key_secret_production_token_xyz_9988';
      const encrypted = encryptAes256Gcm(plaintext, key);

      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.split(':')).toHaveLength(3);

      const decrypted = decryptAes256Gcm(encrypted, key);
      expect(decrypted).toBe(plaintext);
    });

    it('should fail decryption if ciphertext or auth tag is corrupted', () => {
      const plaintext = 'top_secret_credentials';
      const encrypted = encryptAes256Gcm(plaintext, key);

      const parts = encrypted.split(':');
      const corrupted = `${parts[0]}:${parts[1]}:badciphertext`;

      expect(() => decryptAes256Gcm(corrupted, key)).toThrow();
    });
  });
});
