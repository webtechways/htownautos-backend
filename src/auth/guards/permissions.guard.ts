
import { Injectable, CanActivate, ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma.service'; // Adjust path as needed
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private reflector: Reflector, private prisma: PrismaService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (!requiredPermissions) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user = request.user;
        const tenantId = request.headers['x-tenant-id'];

        if (!user) {
            throw new UnauthorizedException('User not authenticated');
        }

        if (!tenantId) {
            // If endpoint requires permissions, it implies tenant context is needed (unless global system admin logic is added)
            throw new ForbiddenException('Tenant context required (X-Tenant-ID header missing)');
        }

        // Fetch TenantUser with Role and Permissions
        const tenantUser = await this.prisma.tenantUser.findUnique({
            where: {
                tenantId_userId: {
                    tenantId: tenantId,
                    userId: user.id || user.sub, // Adjust based on how user object is populated (Cognito sub or DB ID)
                },
            },
            include: {
                role: {
                    include: {
                        permissions: {
                            include: {
                                permission: true,
                            },
                        },
                    },
                },
            },
        });

        if (!tenantUser) {
            throw new ForbiddenException('User is not a member of this tenant');
        }

        // Check if role is active
        if (!tenantUser.role.isActive || !tenantUser.isActive) {
            throw new ForbiddenException('User or Role is inactive in this tenant');
        }

        // 1. Check Role Permissions
        const rolePermissions = tenantUser.role.permissions.map(p => p.permission.slug);

        // 2. Check User Override Permissions (if any)
        // tenantUser.permissions is Json, assuming strict array of strings if present
        const overridePermissions = Array.isArray(tenantUser.permissions) ? (tenantUser.permissions as string[]) : [];

        const allPermissions = new Set([...rolePermissions, ...overridePermissions]);

        // Check if user has ALL required permissions (or ANY? Usually ANY for 'OR' logic, but typically guards enforce ALL for strictness, or create separate decorator for ANY)
        // For simplicity, let's assume we need AT LEAST ONE of the required permissions (common pattern) OR ALL.
        // Let's implement ANY match for flexibility.

        // Superadmin check (by role slug)
        if (tenantUser.role.slug === 'superadmin') {
            return true;
        }

        const hasPermission = requiredPermissions.some(permission => allPermissions.has(permission));

        if (!hasPermission) {
            throw new ForbiddenException('Insufficient permissions');
        }

        return true;
    }
}
