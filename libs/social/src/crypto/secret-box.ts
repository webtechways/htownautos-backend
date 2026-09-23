import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM envelope for social credentials (OAuth tokens, app passwords,
 * WhatsApp permanent tokens, Mastodon client secrets). Key comes from
 * `SOCIAL_TOKEN_KEY` (32 raw bytes, base64-encoded) — required in every
 * environment that touches SocialAccount.encryptedSecrets.
 *
 * Format: `v1:<iv base64>:<authTag base64>:<ciphertext base64>`.
 * A value that does NOT start with the `v1:` prefix is legacy plaintext (the
 * old `SocialAccount.accessToken`/`refreshToken` columns) and is returned
 * as-is by `decryptSecret` — the caller is expected to re-encrypt it on the
 * next write. Never throws on legacy plaintext; only throws on a malformed
 * `v1:` envelope or a bad/missing key.
 */

const ALGORITHM = 'aes-256-gcm';
const VERSION_PREFIX = 'v1:';
const IV_BYTES = 12; // recommended size for GCM

function loadKey(): Buffer {
  const raw = process.env.SOCIAL_TOKEN_KEY;
  if (!raw) {
    throw new Error('SOCIAL_TOKEN_KEY no está configurada');
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('SOCIAL_TOKEN_KEY debe decodificar a 32 bytes (AES-256)');
  }
  return key;
}

/** Encrypts a plaintext secret. Always produces a `v1:` envelope. */
export function encryptSecret(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${VERSION_PREFIX}${iv.toString('base64')}:${authTag.toString('base64')}:${ciphertext.toString('base64')}`;
}

/**
 * Decrypts a `v1:` envelope. A value without the prefix is returned as-is
 * (legacy plaintext). `null`/`undefined` pass through as `null`.
 */
export function decryptSecret(value: string | null | undefined): string | null {
  if (value == null || value === '') return null;
  if (!value.startsWith(VERSION_PREFIX)) return value; // legacy plaintext

  const body = value.slice(VERSION_PREFIX.length);
  const parts = body.split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de secreto cifrado inválido');
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const key = loadKey();
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

/** Convenience wrapper for structured secrets (e.g. a WhatsApp waba/phoneNumberId pair). */
export function encryptJson(value: unknown): string {
  return encryptSecret(JSON.stringify(value));
}

/** Inverse of {@link encryptJson}. Returns `null` for a `null`/empty input. */
export function decryptJson<T = unknown>(value: string | null | undefined): T | null {
  const plaintext = decryptSecret(value);
  if (plaintext == null) return null;
  return JSON.parse(plaintext) as T;
}
