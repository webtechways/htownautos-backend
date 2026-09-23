import { ForbiddenException } from '@nestjs/common';
import { TwilioWebhookController } from './twilio-webhook.controller';

/** Minimal fake of what `assertValidTwilioSignature` reads off the request. */
function fakeReq(overrides: Partial<{ originalUrl: string; protocol: string; headers: Record<string, string>; body: Record<string, string> }> = {}) {
  const headers = overrides.headers ?? {};
  return {
    originalUrl: overrides.originalUrl ?? '/api/v1/twilio/sms/incoming/tenant-1/phone-1',
    protocol: overrides.protocol ?? 'https',
    headers,
    body: overrides.body ?? { Body: 'hola', From: '+15551234567', To: '+15557654321' },
    get(name: string) {
      return headers[name.toLowerCase()];
    },
  } as any;
}

describe('TwilioWebhookController — X-Twilio-Signature validation', () => {
  const originalEnv = { ...process.env };
  let controller: TwilioWebhookController;
  let twilioService: { validateWebhookSignature: jest.Mock };

  beforeEach(() => {
    process.env.PUBLIC_API_URL = 'https://api.htownautos.com';
    process.env.TWILIO_VALIDATE_SIGNATURE = 'true';
    twilioService = { validateWebhookSignature: jest.fn() };
    controller = new TwilioWebhookController({} as any, {} as any, {} as any, {} as any, twilioService as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function call(req: ReturnType<typeof fakeReq>, signature?: string) {
    return (controller as any).assertValidTwilioSignature(req, signature);
  }

  it('passes through when the signature is valid', () => {
    twilioService.validateWebhookSignature.mockReturnValue(true);
    expect(() => call(fakeReq(), 'sig-value')).not.toThrow();
    expect(twilioService.validateWebhookSignature).toHaveBeenCalledWith(
      'sig-value',
      'https://api.htownautos.com/api/v1/twilio/sms/incoming/tenant-1/phone-1',
      { Body: 'hola', From: '+15551234567', To: '+15557654321' },
    );
  });

  it('throws 403 when the signature is invalid', () => {
    twilioService.validateWebhookSignature.mockReturnValue(false);
    expect(() => call(fakeReq(), 'bad-sig')).toThrow(ForbiddenException);
  });

  it('throws 403 when the signature header is missing entirely', () => {
    expect(() => call(fakeReq(), undefined)).toThrow(ForbiddenException);
    expect(twilioService.validateWebhookSignature).not.toHaveBeenCalled();
  });

  it('TWILIO_VALIDATE_SIGNATURE=false bypasses validation (emergency switch)', () => {
    process.env.TWILIO_VALIDATE_SIGNATURE = 'false';
    twilioService.validateWebhookSignature.mockReturnValue(false); // would fail if checked
    expect(() => call(fakeReq(), 'whatever')).not.toThrow();
    expect(twilioService.validateWebhookSignature).not.toHaveBeenCalled();
  });

  it('builds the validation URL from x-forwarded-* when PUBLIC_API_URL is unset', () => {
    delete process.env.PUBLIC_API_URL;
    twilioService.validateWebhookSignature.mockReturnValue(true);
    const req = fakeReq({ headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'api.htownautos.com' } });
    call(req, 'sig-value');
    expect(twilioService.validateWebhookSignature).toHaveBeenCalledWith(
      'sig-value',
      'https://api.htownautos.com/api/v1/twilio/sms/incoming/tenant-1/phone-1',
      expect.anything(),
    );
  });
});
