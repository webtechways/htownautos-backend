import { BadRequestException } from '@nestjs/common';
import { Webhook } from 'standardwebhooks';
import { ClerkWebhooksController } from './clerk-webhooks.controller';

const SIGNING_SECRET = 'whsec_dGVzdC1zaWduaW5nLXNlY3JldC1mb3ItY2xlcmstd2ViaG9va3M=';

function buildSignedRequest(payload: Record<string, unknown>, secret = SIGNING_SECRET) {
  const body = JSON.stringify(payload);
  const wh = new Webhook(secret);
  const id = 'msg_test';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = wh.sign(id, new Date(Number(timestamp) * 1000), body);
  return {
    headers: {
      'svix-id': id,
      'svix-timestamp': timestamp,
      'svix-signature': signature,
    },
    body: Buffer.from(body),
  };
}

describe('ClerkWebhooksController', () => {
  const originalEnv = { ...process.env };
  let controller: ClerkWebhooksController;

  beforeEach(() => {
    process.env.CLERK_WEBHOOK_SIGNING_SECRET = SIGNING_SECRET;
    // Prisma isn't touched before signature verification for the failure cases below.
    controller = new ClerkWebhooksController({} as any);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects when CLERK_WEBHOOK_SIGNING_SECRET is not configured (fails closed)', async () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    const req: any = buildSignedRequest({ type: 'organization.created', data: { id: 'org_1' } });
    await expect(controller.handleWebhook(req)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a request with no svix headers at all', async () => {
    const req: any = { headers: {}, body: Buffer.from(JSON.stringify({ type: 'x' })) };
    await expect(controller.handleWebhook(req)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a request signed with the wrong secret (tampered/forged)', async () => {
    const req: any = buildSignedRequest(
      { type: 'organization.created', data: { id: 'org_1' } },
      'whsec_d29ybGRzLXdvcnN0LXNlY3JldA==',
    );
    await expect(controller.handleWebhook(req)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('accepts a request signed with the correct secret', async () => {
    const req: any = buildSignedRequest({ type: 'organization.deleted', data: { id: 'org_1' } });
    controller = new ClerkWebhooksController({ $queryRawUnsafe: jest.fn().mockResolvedValue([]) } as any);
    await expect(controller.handleWebhook(req)).resolves.toEqual({ received: true });
  });
});
