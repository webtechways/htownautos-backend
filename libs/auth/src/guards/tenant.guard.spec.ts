import { ForbiddenException } from '@nestjs/common';
import { TenantGuard } from './tenant.guard';

function makeContext(request: any, metadata: Record<string, any> = {}) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  };
  const context: any = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  };
  return { context, reflector };
}

describe('TenantGuard — STAFF_ONLY gate', () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      tenant: { findUnique: jest.fn() },
      tenantUser: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(), count: jest.fn() },
      role: { findFirst: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
      $queryRawUnsafe: jest.fn(),
    };
  });

  it('rejects a CUSTOMER user on a normal (non-whitelisted) route with 403 STAFF_ONLY', async () => {
    const request = { user: { id: 'u1', userType: 'CUSTOMER' }, headers: {} };
    const { context, reflector } = makeContext(request, { tenantOptional: false, allowCustomer: undefined });
    const guard = new TenantGuard(reflector as any, prisma);

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'STAFF_ONLY', statusCode: 403 }),
    });
  });

  it('allows a CUSTOMER user through when the route is marked @AllowCustomer()', async () => {
    const request = { user: { id: 'u1', userType: 'CUSTOMER' }, headers: {} };
    // @AllowCustomer() routes here are also @TenantOptional() (PortalController
    // pattern) — the tenantOptional early return happens AFTER the STAFF_ONLY
    // check, so both must be simulated together.
    const { context, reflector } = makeContext(request, { tenantOptional: true, allowCustomer: true });
    const guard = new TenantGuard(reflector as any, prisma);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('STAFF users are unaffected by the STAFF_ONLY check', async () => {
    const request = {
      user: { id: 'u1', userType: 'STAFF' },
      headers: {},
      apiKey: true,
      tenant: { id: 't1', isActive: true },
    };
    const { context, reflector } = makeContext(request, { tenantOptional: false });
    const guard = new TenantGuard(reflector as any, prisma);

    // apiKey + tenant already resolved short-circuits the rest of the guard.
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('a route with no metadata (default) is STAFF_ONLY for CUSTOMER even when tenantOptional is also unset', async () => {
    const request = { user: { id: 'u1', userType: 'CUSTOMER' }, headers: {} };
    const { context, reflector } = makeContext(request, {});
    const guard = new TenantGuard(reflector as any, prisma);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
