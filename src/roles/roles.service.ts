
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';

@Injectable()
export class RolesService {
    constructor(private prisma: PrismaService) { }

    private generateSlug(name: string): string {
        return name
            .toLowerCase()
            .trim()
            .replace(/[^\w\s-]/g, '')
            .replace(/[\s_-]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    async create(createRoleDto: CreateRoleDto, tenantId: string) {
        const { name, description, permissions, slug } = createRoleDto;

        // Auto-generate slug if not provided, else sanitize
        const finalSlug = slug ? this.generateSlug(slug) : this.generateSlug(name);

        // Check if role exists in this tenant (or global system role collision check if we were to allow global creation)
        // For now, assume all created roles via API are tenant-specific
        const existingRole = await this.prisma.role.findUnique({
            where: {
                tenantId_slug: {
                    tenantId: tenantId,
                    slug: finalSlug,
                },
            },
        });

        if (existingRole) {
            throw new BadRequestException(`Role with slug '${finalSlug}' already exists in this dealership.`);
        }

        // Verify permissions exist
        const validPermissions = await this.prisma.permission.findMany({
            where: {
                slug: { in: permissions },
            },
        });

        if (validPermissions.length !== permissions.length) {
            const foundSlugs = validPermissions.map(p => p.slug);
            const invalidSlugs = permissions.filter(p => !foundSlugs.includes(p));
            throw new BadRequestException(`Invalid permissions: ${invalidSlugs.join(', ')}`);
        }

        // Create Role
        const role = await this.prisma.role.create({
            data: {
                name,
                slug: finalSlug,
                description,
                tenantId, // Bind to tenant
                isSystem: false,
                permissions: {
                    create: validPermissions.map(p => ({
                        permissionId: p.id,
                    })),
                },
            },
            include: {
                permissions: {
                    include: {
                        permission: true,
                    },
                },
            },
        });

        return role;
    }

    async findAll(tenantId: string) {
        // Return both Global/System roles AND Tenant-specific roles
        return this.prisma.role.findMany({
            where: {
                OR: [
                    { tenantId: tenantId },
                    { tenantId: null }, // Global/System roles
                ],
            },
            include: {
                permissions: {
                    include: {
                        permission: true,
                    },
                },
            },
        });
    }

    async findOne(id: string, tenantId: string) {
        const role = await this.prisma.role.findUnique({
            where: { id },
            include: {
                permissions: {
                    include: {
                        permission: true,
                    },
                },
            },
        });

        if (!role) {
            throw new NotFoundException('Role not found');
        }

        // Check if role belongs to tenant OR is global
        if (role.tenantId && role.tenantId !== tenantId) {
            throw new ForbiddenException('Access denied to this role');
        }

        return role;
    }

    async update(id: string, updateRoleDto: UpdateRoleDto, tenantId: string) {
        const role = await this.findOne(id, tenantId);

        if (role.isSystem) {
            throw new ForbiddenException('Cannot modify system roles.');
        }

        // Ensure we only update roles belonging to this tenant
        if (!role.tenantId || role.tenantId !== tenantId) {
            // Technically findAll returns global roles too, but we can't edit them here
            throw new ForbiddenException('Cannot modify global/system roles or roles from another tenant.');
        }

        const { permissions, ...data } = updateRoleDto;

        // Handle Permissions update if provided
        if (permissions) {
            // Verify
            const validPermissions = await this.prisma.permission.findMany({
                where: {
                    slug: { in: permissions },
                },
            });

            // Clear existing and add new
            // Transactional ideally, or use deleteMany + create
            await this.prisma.rolePermission.deleteMany({
                where: { roleId: id },
            });

            await this.prisma.rolePermission.createMany({
                data: validPermissions.map(p => ({
                    roleId: id,
                    permissionId: p.id
                }))
            });
        }

        return this.prisma.role.update({
            where: { id },
            data: {
                ...data,
            },
            include: {
                permissions: {
                    include: { permission: true }
                }
            }
        });
    }

    async remove(id: string, tenantId: string) {
        const role = await this.findOne(id, tenantId);

        if (role.isSystem) {
            throw new ForbiddenException('Cannot delete system roles.');
        }

        if (!role.tenantId || role.tenantId !== tenantId) {
            throw new ForbiddenException('Cannot delete global roles.');
        }

        // Check if users are assigned
        const userCount = await this.prisma.tenantUser.count({
            where: { roleId: id }
        });

        if (userCount > 0) {
            throw new BadRequestException('Cannot delete role that is assigned to users. Reassign them first.');
        }

        return this.prisma.role.delete({
            where: { id },
        });
    }
}
