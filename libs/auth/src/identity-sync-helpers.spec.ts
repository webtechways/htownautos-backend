import { ensureUserForBuyer, syncUserOnBuyerRemoved } from './identity-sync-helpers';

function makePrisma(overrides: Record<string, any> = {}) {
  return {
    buyer: {
      findUnique: jest.fn().mockResolvedValue({ userId: null }),
      update: jest.fn().mockResolvedValue({}),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ customerPortalEnabled: true }),
    },
    user: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'u-new' }),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

describe('ensureUserForBuyer', () => {
  it('non-portal tenant: creates the User as CUSTOMER/SKIPPED and never publishes', async () => {
    const prisma = makePrisma({
      tenant: { findUnique: jest.fn().mockResolvedValue({ customerPortalEnabled: false }) },
    });

    const result = await ensureUserForBuyer(prisma as any, {
      buyerId: 'b1',
      tenantId: 't1',
      email: 'Buyer@Example.com',
      phoneMain: null,
      firstName: 'Jane',
      lastName: 'Doe',
    });

    expect(result).toEqual({ userId: 'u-new', shouldPublish: false });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'buyer@example.com', userType: 'CUSTOMER', clerkSyncStatus: 'SKIPPED' }),
      }),
    );
    expect(prisma.user.update).toHaveBeenLastCalledWith({
      where: { id: 'u-new' },
      data: { clerkSyncStatus: 'SKIPPED' },
    });
  });

  it('buyer without email: marks the already-linked User SKIPPED(no_email), never publishes', async () => {
    const prisma = makePrisma({
      buyer: { findUnique: jest.fn().mockResolvedValue({ userId: 'u-existing' }), update: jest.fn() },
    });

    const result = await ensureUserForBuyer(prisma as any, {
      buyerId: 'b1',
      tenantId: 't1',
      email: '',
      phoneMain: null,
      firstName: 'Jane',
      lastName: 'Doe',
    });

    expect(result).toEqual({ userId: 'u-existing', shouldPublish: false });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-existing' },
      data: { clerkSyncStatus: 'SKIPPED', clerkSyncError: 'no_email' },
    });
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('portal tenant, no match: creates a brand-new CUSTOMER User and requests a publish', async () => {
    const prisma = makePrisma();

    const result = await ensureUserForBuyer(prisma as any, {
      buyerId: 'b1',
      tenantId: 't1',
      email: 'new@example.com',
      phoneMain: '7135551234',
      firstName: 'Jane',
      lastName: 'Doe',
    });

    expect(result).toEqual({ userId: 'u-new', shouldPublish: true });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userType: 'CUSTOMER', clerkSyncStatus: 'PENDING', phoneNumber: '+17135551234' }),
      }),
    );
    expect(prisma.buyer.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { userId: 'u-new' } });
  });

  it('portal tenant, matched by email (e.g. an existing staff User): links without creating a new User or overwriting it', async () => {
    const prisma = makePrisma({
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: 'staff-1' }),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    const result = await ensureUserForBuyer(prisma as any, {
      buyerId: 'b1',
      tenantId: 't1',
      email: 'staff@example.com',
      phoneMain: null,
      firstName: 'Staff',
      lastName: 'Member',
    });

    expect(result).toEqual({ userId: 'staff-1', shouldPublish: true });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.buyer.update).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { userId: 'staff-1' } });
    // Only the trailing clerkSyncStatus write touches this User on first link —
    // never its name/phone (never its userType either — the create branch is
    // the only place userType is set, and it wasn't taken here).
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { clerkSyncStatus: 'PENDING', clerkSyncAttempts: 0, clerkSyncError: null },
    });
  });
});

describe('syncUserOnBuyerRemoved', () => {
  it('portal tenant: marks PENDING and requests a publish', async () => {
    const prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ customerPortalEnabled: true }) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };

    const result = await syncUserOnBuyerRemoved(prisma as any, { userId: 'u1', tenantId: 't1' });

    expect(result).toEqual({ shouldPublish: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { clerkSyncStatus: 'PENDING', clerkSyncAttempts: 0, clerkSyncError: null },
    });
  });

  it('non-portal tenant: never touches the User or requests a publish', async () => {
    const prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ customerPortalEnabled: false }) },
      user: { update: jest.fn() },
    };

    const result = await syncUserOnBuyerRemoved(prisma as any, { userId: 'u1', tenantId: 't1' });

    expect(result).toEqual({ shouldPublish: false });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
