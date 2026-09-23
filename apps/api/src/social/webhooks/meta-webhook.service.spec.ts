import { createHmac } from 'crypto';
import { MetaWebhookService } from './meta-webhook.service';

const APP_SECRET = 'test-facebook-app-secret';

function sign(secret: string, body: Buffer): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

describe('MetaWebhookService', () => {
  let service: MetaWebhookService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.FACEBOOK_APP_SECRET = APP_SECRET;
    delete process.env.INSTAGRAM_APP_SECRET;
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'test-verify-token';
    // Constructor deps aren't touched by verifySignature/verifyHandshake — safe to stub.
    service = new MetaWebhookService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('verifySignature', () => {
    it('accepts a signature computed with the configured app secret', () => {
      const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
      expect(service.verifySignature(body, sign(APP_SECRET, body))).toBe(true);
    });

    it('rejects a signature computed with the wrong secret', () => {
      const body = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
      expect(service.verifySignature(body, sign('wrong-secret', body))).toBe(false);
    });

    it('rejects a signature computed over a different body (tampered payload)', () => {
      const original = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
      const tampered = Buffer.from(JSON.stringify({ object: 'page', entry: [{ id: 'evil' }] }));
      expect(service.verifySignature(tampered, sign(APP_SECRET, original))).toBe(false);
    });

    it('rejects a missing header', () => {
      const body = Buffer.from('{}');
      expect(service.verifySignature(body, undefined)).toBe(false);
    });

    it('rejects a header missing the sha256= prefix', () => {
      const body = Buffer.from('{}');
      expect(service.verifySignature(body, createHmac('sha256', APP_SECRET).update(body).digest('hex'))).toBe(false);
    });

    it('rejects everything when no app secret is configured', () => {
      delete process.env.FACEBOOK_APP_SECRET;
      const body = Buffer.from('{}');
      expect(service.verifySignature(body, sign(APP_SECRET, body))).toBe(false);
    });

    it('accepts a signature matching a SECOND configured secret (Instagram app differs from Facebook app)', () => {
      process.env.INSTAGRAM_APP_SECRET = 'test-instagram-app-secret';
      const body = Buffer.from('{}');
      expect(service.verifySignature(body, sign('test-instagram-app-secret', body))).toBe(true);
    });
  });

  describe('verifyHandshake', () => {
    it('accepts a matching subscribe + verify_token', () => {
      expect(service.verifyHandshake('subscribe', 'test-verify-token')).toBe(true);
    });

    it('rejects a wrong verify_token', () => {
      expect(service.verifyHandshake('subscribe', 'wrong-token')).toBe(false);
    });

    it('rejects a non-subscribe mode', () => {
      expect(service.verifyHandshake('unsubscribe', 'test-verify-token')).toBe(false);
    });

    it('rejects a missing verify_token', () => {
      expect(service.verifyHandshake('subscribe', undefined)).toBe(false);
    });
  });
});
