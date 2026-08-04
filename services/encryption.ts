import crypto from 'crypto';

const PREFIX = 'enc:v1:';
let warnedMissingKey = false;

function getKey(): Buffer | null {
  const rawKey = process.env.ENCRYPTION_KEY;
  if (!rawKey || !rawKey.trim()) {
    if (!warnedMissingKey) {
      console.warn('[Encryption] WARNING: ENCRYPTION_KEY environment variable is missing. Field-level encryption for personal user data is disabled.');
      warnedMissingKey = true;
    }
    return null;
  }
  // Derive a deterministic 32-byte key from the provided ENCRYPTION_KEY
  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM with a random IV.
 * Returns IV + Auth Tag + Ciphertext as a formatted string: "enc:v1:<ivHex>:<tagHex>:<cipherHex>"
 * If ENCRYPTION_KEY is missing, logs a warning and returns plaintext unencrypted.
 */
export function encryptField(plaintext: string): string {
  if (!plaintext) return plaintext;

  const key = getKey();
  if (!key) {
    return plaintext;
  }

  try {
    const iv = crypto.randomBytes(12); // 96-bit random IV for AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (err) {
    console.error('[Encryption] Error encrypting field:', err);
    return plaintext;
  }
}

/**
 * Decrypts an encrypted field string produced by encryptField.
 * If input is not in encrypted format or ENCRYPTION_KEY is missing, returns the input string as-is.
 */
export function decryptField(encrypted: string): string {
  if (!encrypted || typeof encrypted !== 'string') return encrypted;
  if (!encrypted.startsWith(PREFIX)) {
    return encrypted; // Plaintext or legacy format
  }

  const key = getKey();
  if (!key) {
    return encrypted;
  }

  try {
    const parts = encrypted.slice(PREFIX.length).split(':');
    if (parts.length !== 3) {
      return encrypted;
    }

    const [ivHex, tagHex, cipherHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const ciphertext = Buffer.from(cipherHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.warn('[Encryption] Failed to decrypt field:', err);
    return encrypted;
  }
}
