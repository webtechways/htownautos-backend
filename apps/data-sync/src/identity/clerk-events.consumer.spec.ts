jest.mock('@htownautos/auth', () => ({
  PORTAL_TENANT_ID: 'portal-tenant',
  recomputeUserType: jest.fn(async (prisma: any, userId: string) => {
    const count = await prisma.tenantUser.count({ where: { userId, isActive: true, status: 'active' } });
    const userType = count > 0 ? 'STAFF' : 'CUSTOMER';
    await prisma.user.update({ where: { id: userId }, data: { userType } });
    return userType;
  }),
}));

import { CLERK_PUSH_QUEUE } from '@htownautos/rabbitmq';
import { recomputeUserType } from '@htownautos/auth';
import { ClerkEventsConsumer } from './clerk-events.consumer';
import { hashDesiredState } from './clerk-desired-state';

function baseUser(overrides: Record<string, any> = {}) {
  return {
    id: 'u1',
    clerkUserId: 'clerk1',
    email: 'buyer@example.com',
    phoneNumber: '+17135551234',
    firstName: 'Jane',
    lastName: 'Doe',
    avatar: null,
    userType: 'CUSTOMER',
    clerkSyncHash: null,
    clerkEventAt: null as Date | null,
    ...overrides,
  };
}

describe('ClerkEventsConsumer.processEvent', () => {
  let prisma: any;
  let rabbitMQ: { publish: jest.Mock };
  let portalSignupNotifier: { notify: jest.Mock };
  let consumer: ClerkEventsConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      clerkWebhookEvent: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      buyer: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      tenantUser: { count: jest.fn().mockResolvedValue(0) },
    };
    rabbitMQ = { publish: jest.fn().mockResolvedValue(true) };
    portalSignupNotifier = { notify: jest.fn().mockResolvedValue(undefined) };
    consumer = new ClerkEventsConsumer(rabbitMQ as any, prisma, portalSignupNotifier as any);
  });

  it('an already-processed event (redelivery) is a no-op — processed once', async () => {
    prisma.clerkWebhookEvent.findUnique.mockResolvedValue({
      id: 'evt1',
      type: 'user.updated',
      payload: { data: {} },
      processedAt: new Date(),
      attempts: 0,
    });

    await consumer.processEvent('evt1');

    expect(prisma.clerkWebhookEvent.update).not.toHaveBeenCalled();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('ignores an out-of-order user.updated (event time <= clerkEventAt)', async () => {
    const user = baseUser({ clerkEventAt: new Date('2026-01-02T00:00:00Z') });
    prisma.clerkWebhookEvent.findUnique.mockResolvedValue({
      id: 'evt2',
      type: 'user.updated',
      processedAt: null,
      attempts: 0,
      payload: {
        data: {
          id: 'clerk1',
          updated_at: new Date('2026-01-01T00:00:00Z').getTime(),
          email_addresses: [],
          phone_numbers: [],
          primary_email_address_id: null,
          primary_phone_number_id: null,
          first_name: 'Stale',
          last_name: 'Name',
        },
      },
    });
    prisma.user.findUnique.mockResolvedValue(user);

    await consumer.processEvent('evt2');

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.clerkWebhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'evt2' }, data: expect.objectContaining({ processedAt: expect.any(Date) }) }),
    );
  });

  it('a Clerk-originated echo (hash matches) only bumps clerkEventAt — never enqueues a push', async () => {
    const user = baseUser();
    // Precompute the exact hash the consumer would derive from this user's
    // current state with zero portal buyers, so the incoming event's
    // "nothing actually changed" state matches it (loop guard).
    const echoHash = hashDesiredState({
      email: user.email,
      phone: user.phoneNumber,
      firstName: user.firstName,
      lastName: user.lastName,
      externalId: user.id,
      publicMetadata: { userType: user.userType, customerTenantIds: [], crmUserId: user.id },
    });
    user.clerkSyncHash = echoHash;

    prisma.clerkWebhookEvent.findUnique.mockResolvedValue({
      id: 'evt3',
      type: 'user.updated',
      processedAt: null,
      attempts: 0,
      payload: {
        data: {
          id: 'clerk1',
          updated_at: Date.now(),
          email_addresses: [],
          phone_numbers: [],
          primary_email_address_id: null,
          primary_phone_number_id: null,
          first_name: null,
          last_name: null,
          image_url: null,
        },
      },
    });
    prisma.user.findUnique.mockResolvedValue(user);

    await consumer.processEvent('evt3');

    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { clerkEventAt: expect.any(Date) },
    });
    expect(prisma.buyer.updateMany).not.toHaveBeenCalled();
    expect(rabbitMQ.publish).not.toHaveBeenCalled();
  });

  it('web sign-up creates a Buyer lead and notifies staff exactly once', async () => {
    prisma.user.findUnique.mockImplementation(async (args: any) => {
      if (args.where.clerkUserId) return null; // not linked yet
      if (args.where.id === 'newUser1') {
        return baseUser({ id: 'newUser1', clerkUserId: 'clerk2', firstName: 'New', lastName: 'Signup' });
      }
      return null;
    });
    prisma.user.create.mockResolvedValue({
      id: 'newUser1',
      email: 'lead@example.com',
      firstName: 'New',
      lastName: 'Signup',
      phoneNumber: null,
      avatar: null,
      userType: 'CUSTOMER',
    });
    prisma.buyer.create.mockResolvedValue({ id: 'buyer1' });

    prisma.clerkWebhookEvent.findUnique.mockResolvedValue({
      id: 'evt4',
      type: 'user.created',
      processedAt: null,
      attempts: 0,
      payload: {
        data: {
          id: 'clerk2',
          external_id: null,
          first_name: 'New',
          last_name: 'Signup',
          image_url: null,
          email_addresses: [{ id: 'em1', email_address: 'lead@example.com', verification: { status: 'verified' } }],
          phone_numbers: [],
          primary_email_address_id: 'em1',
          primary_phone_number_id: null,
          unsafe_metadata: { signupSource: 'web' },
          updated_at: Date.now(),
        },
      },
    });

    await consumer.processEvent('evt4');

    expect(prisma.buyer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: 'portal-tenant', userId: 'newUser1', source: 'web-signup' }),
      }),
    );
    expect(portalSignupNotifier.notify).toHaveBeenCalledTimes(1);
    expect(portalSignupNotifier.notify).toHaveBeenCalledWith('buyer1', expect.any(String));
  });

  it('user.deleted unlinks the Clerk id but never touches the Buyer', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u5', clerkUserId: 'clerk3' });
    prisma.clerkWebhookEvent.findUnique.mockResolvedValue({
      id: 'evt5',
      type: 'user.deleted',
      processedAt: null,
      attempts: 0,
      payload: { data: { id: 'clerk3', external_id: 'u5' } },
    });

    await consumer.processEvent('evt5');

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u5' },
        data: expect.objectContaining({ clerkUserId: null, clerkSyncStatus: 'SKIPPED' }),
      }),
    );
    expect(prisma.buyer.update).not.toHaveBeenCalled();
    expect(prisma.buyer.updateMany).not.toHaveBeenCalled();
  });

  it('an organizationMembership change recomputes userType and refreshes via a push', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'u9', clerkUserId: 'clerk9' });
    prisma.clerkWebhookEvent.findUnique.mockResolvedValue({
      id: 'evt6',
      type: 'organizationMembership.updated',
      processedAt: null,
      attempts: 0,
      payload: { data: { organization: { id: 'org1' }, public_user_data: { user_id: 'clerk9' } } },
    });

    await consumer.processEvent('evt6');

    expect(recomputeUserType).toHaveBeenCalledWith(prisma, 'u9');
    expect(rabbitMQ.publish).toHaveBeenCalledWith(CLERK_PUSH_QUEUE, { userId: 'u9' });
  });
});
