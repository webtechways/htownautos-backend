import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma.service';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no roles specified, allow access
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const tenantId = request.headers['x-tenant-id'];

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    if (!tenantId) {
      throw new ForbiddenException('Tenant context required (X-Tenant-ID header missing)');
    }

    // Fetch TenantUser with Role
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: {
          tenantId: tenantId,
          userId: user.id,
        },
      },
      include: {
        role: {
          select: {
            slug: true,
            name: true,
          },
        },
      },
    });

    if (!tenantUser) {
      throw new ForbiddenException('User is not a member of this tenant');
    }

    if (!tenantUser.isActive) {
      throw new ForbiddenException('User is inactive in this tenant');
    }

    // Check if user's role is in the required roles list
    const userRoleSlug = tenantUser.role.slug;
    const hasRequiredRole = requiredRoles.includes(userRoleSlug);

    if (!hasRequiredRole) {
      throw new ForbiddenException(
        `Access denied. Required roles: ${requiredRoles.join(', ')}. Your role: ${tenantUser.role.name}`,
      );
    }

    return true;
  }
}
