import { randomBytes } from 'crypto';
import { decryptJson, decryptSecret, encryptJson, encryptSecret } from './secret-box';

describe('secret-box', () => {
  const ORIGINAL_KEY = process.env.SOCIAL_TOKEN_KEY;

  beforeEach(() => {
    process.env.SOCIAL_TOKEN_KEY = randomBytes(32).toString('base64');
  });

  afterAll(() => {
    process.env.SOCIAL_TOKEN_KEY = ORIGINAL_KEY;
  });

  it('round-trips a plaintext secret', () => {
    const token = 'EAAG_super_secret_access_token';
    const enc = encryptSecret(token);
    expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc)).toBe(token);
  });

  it('round-trips a JSON payload', () => {
    const payload = { wabaId: '123', phoneNumberId: '456' };
    const enc = encryptJson(payload);
    expect(decryptJson(enc)).toEqual(payload);
  });

  it('returns legacy plaintext (no v1: prefix) as-is', () => {
    const legacy = 'plain-old-token-stored-before-encryption-existed';
    expect(decryptSecret(legacy)).toBe(legacy);
  });

  it('returns null for null/undefined/empty input', () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    expect(decryptSecret('')).toBeNull();
  });

  it('rejects a tampered ciphertext (GCM auth tag mismatch)', () => {
    const enc = encryptSecret('sensitive-value');
    const [prefix, iv, tag, ct] = [enc.slice(0, 3), ...enc.slice(3).split(':')];
    // Flip a character deep in the ciphertext to break the auth tag check.
    const tamperedCt = ct.slice(0, -4) + (ct.slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
    const tampered = `${prefix}${iv}:${tag}:${tamperedCt}`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects a malformed v1 envelope', () => {
    expect(() => decryptSecret('v1:only-one-part')).toThrow();
  });

  it('throws when SOCIAL_TOKEN_KEY is missing', () => {
    delete process.env.SOCIAL_TOKEN_KEY;
    expect(() => encryptSecret('x')).toThrow();
  });

  it('throws when SOCIAL_TOKEN_KEY is not 32 bytes', () => {
    process.env.SOCIAL_TOKEN_KEY = Buffer.from('too-short').toString('base64');
    expect(() => encryptSecret('x')).toThrow();
  });
});
