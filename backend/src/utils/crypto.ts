import crypto from 'node:crypto';
import { config } from '../config/env.js';

/**
 * Cryptographic utility service providing zero-trust security primitives:
 * - Constant-time HMAC-SHA256 signature verification
 * - Replay protection timestamp validation
 * - Deterministic SHA-256 alert fingerprinting
 * - AES-256-GCM authenticated encryption/decryption for credentials at rest
 */

/**
 * Compute an HMAC-SHA256 signature for a given payload.
 */
export function computeHmacSha256(payload: string, secret: string = config.WEBHOOK_HMAC_SECRET): string {
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Verify HMAC signature with constant-time equality check to prevent timing attacks.
 */
export function verifyHmacSignature(
  rawBody: string,
  providedSignature: string,
  secret: string = config.WEBHOOK_HMAC_SECRET
): boolean {
  try {
    // Normalise signature format (strip 'sha256=' prefix if present)
    const cleanSignature = providedSignature.startsWith('sha256=')
      ? providedSignature.slice(7)
      : providedSignature;

    const expectedSignature = computeHmacSha256(rawBody, secret);

    const expectedBuffer = Buffer.from(expectedSignature, 'hex');
    const providedBuffer = Buffer.from(cleanSignature, 'hex');

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  } catch {
    return false;
  }
}

/**
 * Validate timestamp for replay attack prevention (allowed window: default +/- 300 seconds).
 */
export function isTimestampValid(
  timestampStr: string | number,
  maxDriftSeconds: number = 300
): { valid: boolean; reason?: string } {
  const parsed = typeof timestampStr === 'number'
    ? timestampStr * (timestampStr < 1e11 ? 1000 : 1) // Handle seconds vs milliseconds
    : Date.parse(timestampStr);

  if (Number.isNaN(parsed)) {
    return { valid: false, reason: 'Invalid timestamp format' };
  }

  const now = Date.now();
  const drift = Math.abs(now - parsed) / 1000;

  if (drift > maxDriftSeconds) {
    return {
      valid: false,
      reason: `Timestamp drift of ${Math.round(drift)}s exceeds allowed tolerance of ${maxDriftSeconds}s`,
    };
  }

  return { valid: true };
}

/**
 * Compute a deterministic 64-character SHA-256 fingerprint for deduplication.
 */
export function computeAlertFingerprint(parts: {
  source: string;
  service: string;
  environment: string;
  alertName: string;
  cluster?: string;
}): string {
  const normalized = [
    parts.source.trim().toLowerCase(),
    parts.service.trim().toLowerCase(),
    parts.environment.trim().toLowerCase(),
    parts.alertName.trim().toLowerCase(),
    (parts.cluster || 'default').trim().toLowerCase(),
  ].join('|');

  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Encrypt sensitive credential payload using AES-256-GCM.
 * Output format: iv:authTag:ciphertext (hex-encoded)
 */
export function encryptAes256Gcm(
  plaintext: string,
  keyHex: string = config.ENCRYPTION_KEY_HEX
): string {
  const key = Buffer.from(keyHex, 'hex');
  const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt AES-256-GCM encrypted payload.
 */
export function decryptAes256Gcm(
  encryptedString: string,
  keyHex: string = config.ENCRYPTION_KEY_HEX
): string {
  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format (expected iv:authTag:ciphertext)');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];
  const key = Buffer.from(keyHex, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertextHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
