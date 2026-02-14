
import { PrismaClient } from '@prisma/client';

const PERMISSIONS = [
    // Users
    { slug: 'user:read', action: 'read', resource: 'user', description: 'View users' },
    { slug: 'user:create', action: 'create', resource: 'user', description: 'Create users' },
    { slug: 'user:update', action: 'update', resource: 'user', description: 'Update users' },
    { slug: 'user:delete', action: 'delete', resource: 'user', description: 'Delete users' },

    // Vehicles
    { slug: 'vehicle:read', action: 'read', resource: 'vehicle', description: 'View vehicles' },
    { slug: 'vehicle:create', action: 'create', resource: 'vehicle', description: 'Create vehicles' },
    { slug: 'vehicle:update', action: 'update', resource: 'vehicle', description: 'Update vehicles' },
    { slug: 'vehicle:delete', action: 'delete', resource: 'vehicle', description: 'Delete vehicles' },

    // Deals
    { slug: 'deal:read', action: 'read', resource: 'deal', description: 'View deals' },
    { slug: 'deal:create', action: 'create', resource: 'deal', description: 'Create deals' },
    { slug: 'deal:update', action: 'update', resource: 'deal', description: 'Update deals' },
    { slug: 'deal:delete', action: 'delete', resource: 'deal', description: 'Delete deals' },

    // Roles
    { slug: 'role:read', action: 'read', resource: 'role', description: 'View roles' },
    { slug: 'role:create', action: 'create', resource: 'role', description: 'Create roles' },
    { slug: 'role:update', action: 'update', resource: 'role', description: 'Update roles' },
    { slug: 'role:delete', action: 'delete', resource: 'role', description: 'Delete roles' },

    // Tenant
    { slug: 'tenant:read', action: 'read', resource: 'tenant', description: 'View tenant details' },
    { slug: 'tenant:update', action: 'update', resource: 'tenant', description: 'Update tenant settings' },
];

const ROLES = [
    {
        name: 'Super Admin',
        slug: 'superadmin',
        description: 'System Administrator with full access',
        isSystem: true,
        permissions: ['*'], // Logic will handle '*' as all permissions
    },
    {
        name: 'Admin',
        slug: 'admin',
        description: 'Dealership Administrator',
        isSystem: false,
        permissions: ['user:*', 'vehicle:*', 'deal:*', 'role:*', 'tenant:*'],
    },
    {
        name: 'Sales Manager',
        slug: 'sales_manager',
        description: 'Manages sales team and deals',
        isSystem: false,
        permissions: ['user:read', 'vehicle:*', 'deal:*'],
    },
    {
        name: 'Salesperson',
        slug: 'salesperson',
        description: 'Sales representative',
        isSystem: false,
        permissions: ['vehicle:read', 'deal:create', 'deal:read', 'deal:update'],
    },
    {
        name: 'BDC',
        slug: 'bdc',
        description: 'Business Development Center - Inventory view only',
        isSystem: false,
        permissions: ['vehicle:read'],
    },
];

export async function seedRBAC(prisma: PrismaClient) {
    console.log('🛡️  Seeding Roles & Permissions...\n');

    // 1. Seed Permissions
    const permissionMap = new Map();
    for (const perm of PERMISSIONS) {
        const p = await prisma.permission.upsert({
            where: { slug: perm.slug },
            update: {},
            create: perm,
        });
        permissionMap.set(perm.slug, p.id);
    }
    console.log(`✅ Seeded ${PERMISSIONS.length} permissions`);

    // 2. Seed Roles
    for (const roleDef of ROLES) {
        let role;

        // Check if role exists (handling global roles with null tenantId)
        // Prisma upsert doesn't work well with nullable unique fields in Postgres
        const existingRole = await prisma.role.findFirst({
            where: {
                slug: roleDef.slug,
                tenantId: null,
            },
        });

        if (existingRole) {
            role = await prisma.role.update({
                where: { id: existingRole.id },
                data: {
                    name: roleDef.name,
                    description: roleDef.description,
                    isSystem: roleDef.isSystem,
                },
            });
        } else {
            role = await prisma.role.create({
                data: {
                    name: roleDef.name,
                    slug: roleDef.slug,
                    description: roleDef.description,
                    isSystem: roleDef.isSystem,
                    tenantId: null,
                },
            });
        }

        // 3. Assign Permissions
        let rolePermissions: string[] = [];

        if (roleDef.permissions.includes('*')) {
            rolePermissions = Array.from(permissionMap.values());
        } else {
            for (const pattern of roleDef.permissions) {
                if (pattern.endsWith(':*')) {
                    const resource = pattern.split(':')[0];
                    for (const perm of PERMISSIONS) {
                        if (perm.resource === resource) {
                            rolePermissions.push(permissionMap.get(perm.slug));
                        }
                    }
                } else {
                    const id = permissionMap.get(pattern);
                    if (id) rolePermissions.push(id);
                }
            }
        }

        // Upsert RolePermissions
        for (const permissionId of rolePermissions) {
            await prisma.rolePermission.upsert({
                where: {
                    roleId_permissionId: {
                        roleId: role.id,
                        permissionId: permissionId,
                    },
                },
                update: {},
                create: {
                    roleId: role.id,
                    permissionId: permissionId,
                },
            });
        }
    }
    console.log(`✅ Seeded ${ROLES.length} roles with permissions`);
    console.log('🛡️  RBAC seeding completed!');
}
