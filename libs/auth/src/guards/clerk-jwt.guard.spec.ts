import { UnauthorizedException } from '@nestjs/common';

const mockGetUser = jest.fn();

jest.mock('@clerk/backend', () => ({
  verifyToken: jest.fn(),
  createClerkClient: () => ({
    users: { getUser: (...args: any[]) => mockGetUser(...args) },
  }),
}));

// Imported AFTER the mock so the module-scope `clerkClient` picks it up.
import { ClerkJwtGuard } from './clerk-jwt.guard';

function makeClerkUser(overrides: Partial<{ id: string; email: string; verified: boolean }>) {
  const id = overrides.id ?? 'clerk_new';
  const email = overrides.email ?? 'someone@example.com';
  const verified = overrides.verified ?? true;
  return {
    id,
    firstName: 'Test',
    lastName: 'User',
    imageUrl: null,
    primaryEmailAddressId: 'ea_1',
    emailAddresses: [
      { id: 'ea_1', emailAddress: email, verification: { status: verified ? 'verified' : 'unverified' } },
    ],
  };
}

function notFoundError() {
  const err: any = new Error('not found');
  err.status = 404;
  return err;
}

describe('ClerkJwtGuard.getOrCreateUser (private, exercised via cast)', () => {
  let prisma: any;
  let guard: ClerkJwtGuard;
  const request = { headers: { 'user-agent': 'jest' } };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() },
      auditLog: { create: jest.fn().mockResolvedValue(undefined) },
    };
    guard = new ClerkJwtGuard({} as any, prisma);
  });

  it('fast path: does not call Clerk when the user is already linked by clerkUserId', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      clerkUserId: 'clerk_1',
      email: 'a@b.com',
      isActive: true,
      tenants: [],
    });

    await (guard as any).getOrCreateUser('clerk_1', { email: 'forged@evil.com' }, request);

    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('refuses to relink when the matched row already has a different LIVE clerkUserId', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null) // not found by clerkUserId (the new sub)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'victim@example.com',
        clerkUserId: 'clerk_other_live',
        firstName: 'V',
        lastName: 'Ictim',
        tenants: [],
      });
    mockGetUser
      .mockResolvedValueOnce(makeClerkUser({ id: 'clerk_new', email: 'victim@example.com' })) // identity of the new sub
      .mockResolvedValueOnce(makeClerkUser({ id: 'clerk_other_live' })); // userIsGone check: still exists -> live

    await expect(
      (guard as any).getOrCreateUser('clerk_new', null, request),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'user-link-refused' }) }),
    );
  });

  it('relinks when the row´s old clerkUserId returns 404 from Clerk (dead account)', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'staff@example.com',
        clerkUserId: 'clerk_dead',
        firstName: null,
        lastName: null,
        avatar: null,
        tenants: [],
      });
    mockGetUser
      .mockResolvedValueOnce(makeClerkUser({ id: 'clerk_new', email: 'staff@example.com' }))
      .mockRejectedValueOnce(notFoundError()); // userIsGone('clerk_dead') -> true
    prisma.user.update.mockResolvedValue({
      id: 'u1',
      clerkUserId: 'clerk_new',
      email: 'staff@example.com',
      isActive: true,
      tenants: [],
    });

    const result = await (guard as any).getOrCreateUser('clerk_new', null, request);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ clerkUserId: 'clerk_new' }) }),
    );
    expect(result.clerkUserId).toBe('clerk_new');
  });

  it('ignores a forged X-Clerk-User email and uses the Clerk-verified email for lookup/creation', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce(null) // not found by clerkUserId
      .mockResolvedValueOnce(null); // no existing user with the VERIFIED email
    mockGetUser.mockResolvedValueOnce(makeClerkUser({ id: 'clerk_brand_new', email: 'real@example.com' }));
    prisma.user.create.mockResolvedValue({
      id: 'u2',
      clerkUserId: 'clerk_brand_new',
      email: 'real@example.com',
      isActive: true,
      tenants: [],
    });

    await (guard as any).getOrCreateUser(
      'clerk_brand_new',
      { email: 'forged@attacker.com', first_name: 'Forged' },
      request,
    );

    expect(prisma.user.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { email: 'real@example.com' } }));
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'real@example.com' }) }),
    );
  });
});
