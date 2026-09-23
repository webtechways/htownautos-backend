import { signOAuthState, verifyOAuthState } from '../oauth/oauth-state';
import { peekStateNonce } from './oauth-state-nonce';

describe('peekStateNonce', () => {
  const ORIGINAL_SECRET = process.env.OAUTH_STATE_SECRET;

  beforeEach(() => {
    process.env.OAUTH_STATE_SECRET = 'test-secret-please-ignore';
  });

  afterAll(() => {
    process.env.OAUTH_STATE_SECRET = ORIGINAL_SECRET;
  });

  it('matches the nonce a verified state carries — the PKCE/Mastodon-app Redis key must line up', () => {
    const state = signOAuthState({ platform: 'x', tenantId: 't1', userId: 'u1' });
    const peeked = peekStateNonce(state);
    const verified = verifyOAuthState(state, { tenantId: 't1', userId: 'u1' });
    expect(peeked).toBe(verified.nonce);
  });

  it('throws on a garbage string', () => {
    expect(() => peekStateNonce('not-a-state')).toThrow();
    expect(() => peekStateNonce('')).toThrow();
  });
});
