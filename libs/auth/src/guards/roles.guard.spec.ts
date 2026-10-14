import { ForbiddenException } from '@nestjs/common';
import { RolesGuard } from './roles.guard';

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

describe('RolesGuard — @AllowApiKey() opt-in', () => {
  let prisma: any;

  beforeEach(() => {
    prisma = {
      tenantUser: { findUnique: jest.fn() },
    };
  });

  it('passes through routes with no @RequireRoles metadata', async () => {
    const request = { user: { id: 'u1' }, tenant: { id: 't1' } };
    const { context, reflector } = makeContext(request, { roles: undefined });
    const guard = new RolesGuard(reflector as any, prisma);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.tenantUser.findUnique).not.toHaveBeenCalled();
  });

  it('rejects an API key caller on a @RequireRoles route NOT marked @AllowApiKey()', async () => {
    const request = {
      user: { id: 'api-key:k1' },
      tenant: { id: 't1' },
      apiKey: { id: 'k1', scopes: ['social:write'] },
    };
    const { context, reflector } = makeContext(request, { roles: ['owner', 'admin', 'manager'], allowApiKey: undefined });
    const guard = new RolesGuard(reflector as any, prisma);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tenantUser.findUnique).not.toHaveBeenCalled();
  });

  it('allows an API key caller through on a route marked @AllowApiKey(), without a TenantUser lookup', async () => {
    const request = {
      user: { id: 'api-key:k1' },
      tenant: { id: 't1' },
      apiKey: { id: 'k1', scopes: ['social:write'] },
    };
    const { context, reflector } = makeContext(request, { roles: ['owner', 'admin', 'manager'], allowApiKey: true });
    const guard = new RolesGuard(reflector as any, prisma);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.tenantUser.findUnique).not.toHaveBeenCalled();
  });

  it('still enforces the normal TenantUser/role check for a human (non-API-key) caller, even on an @AllowApiKey() route', async () => {
    const request = { user: { id: 'u1' }, tenant: { id: 't1' } };
    prisma.tenantUser.findUnique.mockResolvedValue(null);
    const { context, reflector } = makeContext(request, { roles: ['owner', 'admin', 'manager'], allowApiKey: true });
    const guard = new RolesGuard(reflector as any, prisma);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.tenantUser.findUnique).toHaveBeenCalled();
  });
});
