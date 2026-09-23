import { createHash } from 'crypto';
import { generatePkcePair, buildXOAuthUrl } from './x';

describe('X PKCE', () => {
  it('generates a verifier whose S256 hash matches the challenge', () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    const expected = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(expected);
  });

  it('produces a fresh, independent pair every call', () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });

  it('embeds the challenge and state in the authorize URL', () => {
    const { codeChallenge } = generatePkcePair();
    const url = buildXOAuthUrl('client-1', 'https://app.example.com/callback', 'state-abc', codeChallenge);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('code_challenge')).toBe(codeChallenge);
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('state')).toBe('state-abc');
    expect(parsed.searchParams.get('client_id')).toBe('client-1');
  });
});
