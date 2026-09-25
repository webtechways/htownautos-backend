const mockUsers = {
  getUserList: jest.fn(),
  getUser: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  updateUserMetadata: jest.fn(),
  banUser: jest.fn(),
};
const mockEmailAddresses = { createEmailAddress: jest.fn() };
const mockPhoneNumbers = { createPhoneNumber: jest.fn() };
const mockClerkClient = { users: mockUsers, emailAddresses: mockEmailAddresses, phoneNumbers: mockPhoneNumbers };

jest.mock('@htownautos/auth', () => ({
  createClerkAdminClient: () => mockClerkClient,
}));

import { IdentityClerkPushConsumer } from './identity-clerk-push.consumer';

function baseUser(overrides: Record<string, any> = {}) {
  return {
    id: 'u1',
    clerkUserId: null,
    email: 'buyer@example.com',
    phoneNumber: null,
    firstName: 'Jane',
    lastName: 'Doe',
    userType: 'CUSTOMER',
    clerkSyncStatus: 'PENDING',
    clerkSyncHash: null,
    clerkSyncAttempts: 0,
    ...overrides,
  };
}

describe('IdentityClerkPushConsumer.pushUser', () => {
  let prisma: any;
  let quotaNotifier: { notifyOnce: jest.Mock };
  let consumer: IdentityClerkPushConsumer;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
      buyer: { findMany: jest.fn().mockResolvedValue([{ tenantId: 'portal-tenant' }]) },
    };
    quotaNotifier = { notifyOnce: jest.fn().mockResolvedValue(undefined) };
    consumer = new IdentityClerkPushConsumer({} as any, prisma, quotaNotifier as any);
  });

  it('links by email without ever touching a password', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser());
    mockUsers.getUserList.mockResolvedValueOnce({ data: [{ id: 'clerk-existing' }], totalCount: 1 });
    mockUsers.getUser.mockResolvedValue({
      emailAddresses: [{ id: 'em1', emailAddress: 'buyer@example.com' }],
      primaryEmailAddressId: 'em1',
      phoneNumbers: [],
      primaryPhoneNumberId: null,
    });

    await consumer.pushUser('u1');

    expect(mockUsers.createUser).not.toHaveBeenCalled();
    expect(mockUsers.updateUser).toHaveBeenCalledWith(
      'clerk-existing',
      expect.not.objectContaining({ password: expect.anything() }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: expect.objectContaining({ clerkUserId: 'clerk-existing', clerkSyncStatus: 'SYNCED' }),
      }),
    );
  });

  it('creates a Clerk user with skipPasswordRequirement when none exists to link', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser());
    mockUsers.getUserList.mockResolvedValueOnce({ data: [], totalCount: 0 });
    mockUsers.createUser.mockResolvedValueOnce({ id: 'clerk-new' });

    await consumer.pushUser('u1');

    expect(mockUsers.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: ['buyer@example.com'],
        externalId: 'u1',
        skipPasswordRequirement: true,
      }),
    );
    expect((mockUsers.createUser.mock.calls[0][0] as any).password).toBeUndefined();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clerkUserId: 'clerk-new', clerkSyncStatus: 'SYNCED' }) }),
    );
  });

  it('is a no-op past the hash check — no Clerk calls when nothing changed', async () => {
    // Priming call to learn the hash for this exact desired state.
    let capturedHash = '';
    prisma.user.findUnique.mockResolvedValueOnce(baseUser({ clerkUserId: 'clerk-1' }));
    mockUsers.getUser.mockResolvedValue({
      emailAddresses: [{ id: 'em1', emailAddress: 'buyer@example.com' }],
      primaryEmailAddressId: 'em1',
      phoneNumbers: [],
      primaryPhoneNumberId: null,
    });
    prisma.user.update.mockImplementationOnce(async (args: any) => {
      capturedHash = args.data.clerkSyncHash;
      return {};
    });
    await consumer.pushUser('u1');
    expect(capturedHash).toBeTruthy();

    jest.clearAllMocks();
    prisma.buyer.findMany.mockResolvedValue([{ tenantId: 'portal-tenant' }]);
    prisma.user.update.mockResolvedValue({});
    prisma.user.findUnique.mockResolvedValue(baseUser({ clerkUserId: 'clerk-1', clerkSyncHash: capturedHash }));

    await consumer.pushUser('u1');

    expect(mockUsers.createUser).not.toHaveBeenCalled();
    expect(mockUsers.updateUser).not.toHaveBeenCalled();
    expect(mockUsers.updateUserMetadata).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clerkSyncStatus: 'SYNCED' }) }),
    );
  });

  it('bans the Clerk account when the last portal buyer is gone', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser({ clerkUserId: 'clerk-9' }));
    prisma.buyer.findMany.mockResolvedValue([]);

    await consumer.pushUser('u1');

    expect(mockUsers.banUser).toHaveBeenCalledWith('clerk-9');
    expect(mockUsers.createUser).not.toHaveBeenCalled();
    expect(mockUsers.updateUser).not.toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clerkSyncStatus: 'SKIPPED' }) }),
    );
  });

  it('quota exceeded: marks FAILED and notifies admins exactly once', async () => {
    prisma.user.findUnique.mockResolvedValue(baseUser());
    mockUsers.getUserList.mockResolvedValueOnce({ data: [], totalCount: 0 });
    mockUsers.createUser.mockRejectedValueOnce({ status: 429, message: 'quota exceeded' });

    await consumer.pushUser('u1');

    expect(quotaNotifier.notifyOnce).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clerkSyncStatus: 'FAILED',
          clerkSyncError: expect.stringContaining('user_quota_exceeded'),
        }),
      }),
    );
  });
});
