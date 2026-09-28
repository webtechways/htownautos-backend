import { recomputeUserType } from './recompute-user-type';

describe('recomputeUserType', () => {
  it('sets STAFF when the user has >=1 active TenantUser membership with a non-"customer" role', async () => {
    const prisma = {
      tenantUser: { count: jest.fn().mockResolvedValue(1) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };

    const result = await recomputeUserType(prisma as any, 'u1');

    expect(prisma.tenantUser.count).toHaveBeenCalledWith({
      where: { userId: 'u1', isActive: true, status: 'active', role: { slug: { not: 'customer' } } },
    });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { userType: 'STAFF' },
    });
    expect(result).toBe('STAFF');
  });

  it('sets CUSTOMER when every active membership is the "customer" role (public stats app)', async () => {
    // The query itself excludes role.slug='customer', so this is exercised
    // by mocking count() to 0 — same as "no membership at all" from the
    // helper's point of view, per design (see recompute-user-type.ts).
    const prisma = {
      tenantUser: { count: jest.fn().mockResolvedValue(0) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };

    const result = await recomputeUserType(prisma as any, 'u-customer-role');

    expect(result).toBe('CUSTOMER');
  });

  it('sets CUSTOMER when the user has no active TenantUser membership', async () => {
    const prisma = {
      tenantUser: { count: jest.fn().mockResolvedValue(0) },
      user: { update: jest.fn().mockResolvedValue({}) },
    };

    const result = await recomputeUserType(prisma as any, 'u2');

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { userType: 'CUSTOMER' },
    });
    expect(result).toBe('CUSTOMER');
  });

  it('is best-effort: swallows errors and returns null instead of throwing', async () => {
    const prisma = {
      tenantUser: { count: jest.fn().mockRejectedValue(new Error('db down')) },
      user: { update: jest.fn() },
    };

    const result = await recomputeUserType(prisma as any, 'u3');

    expect(result).toBeNull();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
