import { signOAuthState, verifyOAuthState } from './oauth-state';

describe('oauth-state', () => {
  const ORIGINAL_SECRET = process.env.OAUTH_STATE_SECRET;
  const tenantId = 'tenant-1';
  const userId = 'user-1';

  beforeEach(() => {
    process.env.OAUTH_STATE_SECRET = 'test-secret-please-ignore';
  });

  afterAll(() => {
    process.env.OAUTH_STATE_SECRET = ORIGINAL_SECRET;
  });

  it('round-trips a valid state', () => {
    const state = signOAuthState({ platform: 'facebook', tenantId, userId });
    const payload = verifyOAuthState(state, { tenantId, userId });
    expect(payload.platform).toBe('facebook');
    expect(payload.tenantId).toBe(tenantId);
    expect(payload.userId).toBe(userId);
    expect(typeof payload.nonce).toBe('string');
    expect(payload.nonce.length).toBeGreaterThan(0);
  });

  it('carries optional accountType/instance through', () => {
    const state = signOAuthState({
      platform: 'mastodon',
      tenantId,
      userId,
      instance: 'mastodon.social',
    });
    const payload = verifyOAuthState(state, { tenantId, userId });
    expect(payload.instance).toBe('mastodon.social');
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const state = signOAuthState({ platform: 'facebook', tenantId, userId });
    const [body, signature] = state.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    decoded.tenantId = 'attacker-tenant';
    const tamperedBody = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
    const tampered = `${tamperedBody}.${signature}`;
    expect(() => verifyOAuthState(tampered, { tenantId, userId })).toThrow();
  });

  it('rejects an expired state', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const state = signOAuthState({ platform: 'facebook', tenantId, userId });
    jest.setSystemTime(new Date('2026-01-01T00:11:00Z')); // 11 min later, past the 10 min TTL
    expect(() => verifyOAuthState(state, { tenantId, userId })).toThrow();
    jest.useRealTimers();
  });

  it('rejects a state issued for a different tenant/user', () => {
    const state = signOAuthState({ platform: 'facebook', tenantId, userId });
    expect(() => verifyOAuthState(state, { tenantId: 'other-tenant', userId })).toThrow();
    expect(() => verifyOAuthState(state, { tenantId, userId: 'other-user' })).toThrow();
  });

  it('rejects a malformed state string', () => {
    expect(() => verifyOAuthState('not-a-real-state', { tenantId, userId })).toThrow();
    expect(() => verifyOAuthState('', { tenantId, userId })).toThrow();
  });
});
