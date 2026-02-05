import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { QueryTenantDto } from './dto/query-tenant.dto';
import {
  AddUserToTenantDto,
  InviteUserToTenantDto,
  UpdateTenantUserDto,
} from './dto/add-user-to-tenant.dto';
import { Prisma } from '@prisma/client';

// Invitation status constants
export const INVITATION_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
} as const;

@Injectable()
export class TenantService {
  constructor(private prisma: PrismaService) {}

  async create(createTenantDto: CreateTenantDto, creatorUserId: string) {
    // Check if slug already exists
    const existingSlug = await this.prisma.tenant.findUnique({
      where: { slug: createTenantDto.slug },
    });

    if (existingSlug) {
      throw new ConflictException(
        `Tenant with slug '${createTenantDto.slug}' already exists`,
      );
    }

    // Verify the creator user exists
    const creatorUser = await this.prisma.user.findUnique({
      where: { id: creatorUserId },
    });

    if (!creatorUser) {
      throw new NotFoundException(
        `User with ID '${creatorUserId}' not found`,
      );
    }

    // Get or create the owner role (global role)
    let ownerRole = await this.prisma.role.findFirst({
      where: {
        slug: 'owner',
        tenantId: null, // Global role
      },
    });

    if (!ownerRole) {
      // Create the global owner role if it doesn't exist
      ownerRole = await this.prisma.role.create({
        data: {
          name: 'Owner',
          slug: 'owner',
          description: 'Tenant owner with full access',
          isSystem: true,
          tenantId: null,
        },
      });
    }

    // Create tenant and owner relationship in a transaction
    const tenant = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create the tenant
      const newTenant = await tx.tenant.create({
        data: createTenantDto,
      });

      // Create the TenantUser relationship with owner role
      await tx.tenantUser.create({
        data: {
          tenantId: newTenant.id,
          userId: creatorUserId,
          roleId: ownerRole.id,
          status: 'active',
          isActive: true,
          acceptedAt: new Date(),
        },
      });

      return newTenant;
    });

    // Return tenant with owner info
    return this.prisma.tenant.findUnique({
      where: { id: tenant.id },
      include: {
        users: {
          where: { userId: creatorUserId },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                name: true,
                firstName: true,
                lastName: true,
              },
            },
            role: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
      },
    });
  }

  async findAll(query: QueryTenantDto) {
    const {
      search,
      city,
      state,
      isActive,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;

    const where: Prisma.TenantWhereInput = {};

    // Search filter
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { businessName: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }

    // City filter
    if (city) {
      where.city = { contains: city, mode: 'insensitive' };
    }

    // State filter
    if (state) {
      where.state = { equals: state, mode: 'insensitive' };
    }

    // Active status filter
    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.tenant.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with ID '${id}' not found`);
    }

    return tenant;
  }

  async findBySlug(slug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant with slug '${slug}' not found`);
    }

    return tenant;
  }

  async findOneWithStats(id: string) {
    const tenant = await this.findOne(id);

    const [userCount, vehicleCount, dealCount, buyerCount] = await Promise.all([
      this.prisma.tenantUser.count({ where: { tenantId: id } }),
      this.prisma.vehicle.count({ where: { tenantId: id } }),
      this.prisma.deal.count({ where: { tenantId: id } }),
      this.prisma.buyer.count({ where: { tenantId: id } }),
    ]);

    return {
      ...tenant,
      userCount,
      vehicleCount,
      dealCount,
      buyerCount,
    };
  }

  async update(id: string, updateTenantDto: UpdateTenantDto) {
    await this.findOne(id);

    // If updating slug, check it doesn't already exist
    if (updateTenantDto.slug) {
      const existingSlug = await this.prisma.tenant.findFirst({
        where: {
          slug: updateTenantDto.slug,
          id: { not: id },
        },
      });

      if (existingSlug) {
        throw new ConflictException(
          `Tenant with slug '${updateTenantDto.slug}' already exists`,
        );
      }
    }

    return this.prisma.tenant.update({
      where: { id },
      data: updateTenantDto,
    });
  }

  async updateSettings(id: string, settings: Record<string, any>) {
    const tenant = await this.findOne(id);

    // Merge existing settings with new settings
    const mergedSettings = {
      ...(tenant.settings as object || {}),
      ...settings,
    };

    return this.prisma.tenant.update({
      where: { id },
      data: { settings: mergedSettings },
    });
  }

  async activate(id: string) {
    await this.findOne(id);

    return this.prisma.tenant.update({
      where: { id },
      data: { isActive: true },
    });
  }

  async deactivate(id: string) {
    await this.findOne(id);

    return this.prisma.tenant.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /**
   * Delete a tenant permanently
   * Only the tenant owner can perform this action
   */
  async remove(id: string, requestingUserId: string) {
    const tenant = await this.findOneWithStats(id);

    // Verify the requesting user is the owner
    await this.verifyOwnership(id, requestingUserId);

    // Prevent deletion if tenant has data (excluding the owner from user count)
    const nonOwnerUserCount = tenant.userCount - 1; // Subtract the owner
    if (
      nonOwnerUserCount > 0 ||
      tenant.vehicleCount > 0 ||
      tenant.dealCount > 0 ||
      tenant.buyerCount > 0
    ) {
      throw new BadRequestException(
        `Cannot delete tenant '${tenant.name}' because it has associated data. ` +
          `Other users: ${nonOwnerUserCount}, Vehicles: ${tenant.vehicleCount}, ` +
          `Deals: ${tenant.dealCount}, Buyers: ${tenant.buyerCount}. ` +
          `Please deactivate the tenant instead or remove all associated data first.`,
      );
    }

    // Delete the tenant and the owner's TenantUser record in a transaction
    await this.prisma.$transaction([
      // Delete the owner's TenantUser record first
      this.prisma.tenantUser.delete({
        where: {
          tenantId_userId: { tenantId: id, userId: requestingUserId },
        },
      }),
      // Then delete the tenant
      this.prisma.tenant.delete({ where: { id } }),
    ]);

    return {
      message: `Tenant '${tenant.name}' has been successfully deleted`,
    };
  }

  async getUsers(id: string) {
    await this.findOne(id);

    return this.prisma.tenantUser.findMany({
      where: { tenantId: id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            avatar: true,
            isActive: true,
            lastLoginAt: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  async checkSlugAvailability(slug: string): Promise<{ available: boolean }> {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    return { available: !existing };
  }

  // ========================================
  // USER MANAGEMENT METHODS
  // ========================================

  /**
   * Check if a user is the owner of a tenant
   * Owner is defined as a user with role slug 'owner' in the tenant
   */
  async isOwner(tenantId: string, userId: string): Promise<boolean> {
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      include: {
        role: true,
      },
    });

    return tenantUser?.role?.slug === 'owner';
  }

  /**
   * Verify that the requesting user is the owner of the tenant
   * Throws ForbiddenException if not
   */
  async verifyOwnership(tenantId: string, requestingUserId: string): Promise<void> {
    const isOwner = await this.isOwner(tenantId, requestingUserId);

    if (!isOwner) {
      throw new ForbiddenException(
        'Only the tenant owner can perform this action',
      );
    }
  }

  /**
   * Add a user to a tenant with a specific role
   * Only the tenant owner can perform this action
   */
  async addUserToTenant(
    tenantId: string,
    addUserDto: AddUserToTenantDto,
    requestingUserId: string,
  ) {
    // Verify the tenant exists
    await this.findOne(tenantId);

    // Verify the requesting user is the owner
    await this.verifyOwnership(tenantId, requestingUserId);

    // Verify the user exists
    const user = await this.prisma.user.findUnique({
      where: { id: addUserDto.userId },
    });

    if (!user) {
      throw new NotFoundException(
        `User with ID '${addUserDto.userId}' not found`,
      );
    }

    // Verify the role exists and belongs to this tenant or is global
    const role = await this.prisma.role.findFirst({
      where: {
        id: addUserDto.roleId,
        OR: [
          { tenantId: tenantId },
          { tenantId: null }, // Global role
        ],
      },
    });

    if (!role) {
      throw new NotFoundException(
        `Role with ID '${addUserDto.roleId}' not found or not available for this tenant`,
      );
    }

    // Prevent assigning owner role (there can only be one owner)
    if (role.slug === 'owner') {
      throw new BadRequestException(
        'Cannot assign owner role. Each tenant can only have one owner.',
      );
    }

    // Check if user is already in this tenant
    const existingTenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId: addUserDto.userId },
      },
    });

    if (existingTenantUser) {
      throw new ConflictException(
        `User is already a member of this tenant`,
      );
    }

    // Add user to tenant
    return this.prisma.tenantUser.create({
      data: {
        tenantId,
        userId: addUserDto.userId,
        roleId: addUserDto.roleId,
        permissions: addUserDto.permissions || undefined,
        isActive: addUserDto.isActive ?? true,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  /**
   * Update a user's role or permissions in a tenant
   * Only the tenant owner can perform this action
   */
  async updateTenantUser(
    tenantId: string,
    userId: string,
    updateDto: UpdateTenantUserDto,
    requestingUserId: string,
  ) {
    // Verify the tenant exists
    await this.findOne(tenantId);

    // Verify the requesting user is the owner
    await this.verifyOwnership(tenantId, requestingUserId);

    // Verify the user is in this tenant
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      include: { role: true },
    });

    if (!tenantUser) {
      throw new NotFoundException(
        `User is not a member of this tenant`,
      );
    }

    // Prevent modifying the owner
    if (tenantUser.role.slug === 'owner') {
      throw new BadRequestException(
        'Cannot modify the tenant owner',
      );
    }

    // If updating role, verify it exists and is valid
    if (updateDto.roleId) {
      const role = await this.prisma.role.findFirst({
        where: {
          id: updateDto.roleId,
          OR: [
            { tenantId: tenantId },
            { tenantId: null },
          ],
        },
      });

      if (!role) {
        throw new NotFoundException(
          `Role with ID '${updateDto.roleId}' not found or not available for this tenant`,
        );
      }

      // Prevent assigning owner role
      if (role.slug === 'owner') {
        throw new BadRequestException(
          'Cannot assign owner role',
        );
      }
    }

    return this.prisma.tenantUser.update({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      data: updateDto,
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
            avatar: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  /**
   * Remove a user from a tenant
   * Only the tenant owner can perform this action
   */
  async removeUserFromTenant(
    tenantId: string,
    userId: string,
    requestingUserId: string,
  ) {
    // Verify the tenant exists
    const tenant = await this.findOne(tenantId);

    // Verify the requesting user is the owner
    await this.verifyOwnership(tenantId, requestingUserId);

    // Verify the user is in this tenant
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      include: { role: true, user: true },
    });

    if (!tenantUser) {
      throw new NotFoundException(
        `User is not a member of this tenant`,
      );
    }

    // Prevent removing the owner
    if (tenantUser.role.slug === 'owner') {
      throw new BadRequestException(
        'Cannot remove the tenant owner. Transfer ownership first.',
      );
    }

    await this.prisma.tenantUser.delete({
      where: {
        tenantId_userId: { tenantId, userId },
      },
    });

    return {
      message: `User '${tenantUser.user.email}' has been removed from tenant '${tenant.name}'`,
    };
  }

  /**
   * Transfer ownership of a tenant to another user
   * Only the current owner can perform this action
   */
  async transferOwnership(
    tenantId: string,
    newOwnerId: string,
    requestingUserId: string,
  ) {
    // Verify the tenant exists
    await this.findOne(tenantId);

    // Verify the requesting user is the current owner
    await this.verifyOwnership(tenantId, requestingUserId);

    // Verify new owner is already an active member of the tenant
    const newOwnerTenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId: newOwnerId },
      },
    });

    if (!newOwnerTenantUser) {
      throw new BadRequestException(
        'New owner must be an existing member of the tenant',
      );
    }

    // Verify the new owner is active (not pending or suspended)
    if (newOwnerTenantUser.status !== INVITATION_STATUS.ACTIVE) {
      throw new BadRequestException(
        'New owner must have an active membership. Pending or suspended users cannot become owners.',
      );
    }

    // Also verify isActive flag
    if (!newOwnerTenantUser.isActive) {
      throw new BadRequestException(
        'New owner must be an active member. Disabled users cannot become owners.',
      );
    }

    // Get the owner role
    const ownerRole = await this.prisma.role.findFirst({
      where: {
        slug: 'owner',
        OR: [
          { tenantId: tenantId },
          { tenantId: null },
        ],
      },
    });

    if (!ownerRole) {
      throw new NotFoundException(
        'Owner role not found. Please contact support.',
      );
    }

    // Get a default role for the previous owner (admin or manager)
    const defaultRole = await this.prisma.role.findFirst({
      where: {
        slug: { in: ['admin', 'manager'] },
        OR: [
          { tenantId: tenantId },
          { tenantId: null },
        ],
      },
    });

    if (!defaultRole) {
      throw new NotFoundException(
        'No suitable role found for previous owner. Please contact support.',
      );
    }

    // Perform the transfer in a transaction
    await this.prisma.$transaction([
      // Demote current owner to admin/manager
      this.prisma.tenantUser.update({
        where: {
          tenantId_userId: { tenantId, userId: requestingUserId },
        },
        data: { roleId: defaultRole.id },
      }),
      // Promote new owner
      this.prisma.tenantUser.update({
        where: {
          tenantId_userId: { tenantId, userId: newOwnerId },
        },
        data: { roleId: ownerRole.id },
      }),
    ]);

    return {
      message: 'Ownership transferred successfully',
      previousOwnerId: requestingUserId,
      newOwnerId: newOwnerId,
    };
  }

  // ========================================
  // INVITATION METHODS
  // ========================================

  /**
   * Generate a secure random invitation code
   */
  private generateInvitationCode(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Invite a user to a tenant by email
   * Creates a pending TenantUser with an invitation code
   * Only the tenant owner can perform this action
   */
  async inviteUserToTenant(
    tenantId: string,
    inviteDto: InviteUserToTenantDto,
    requestingUserId: string,
  ) {
    // Verify the tenant exists
    const tenant = await this.findOne(tenantId);

    // Verify the requesting user is the owner
    await this.verifyOwnership(tenantId, requestingUserId);

    // Find the user by email
    const user = await this.prisma.user.findUnique({
      where: { email: inviteDto.email },
    });

    if (!user) {
      throw new NotFoundException(
        `User with email '${inviteDto.email}' not found. The user must have an account first.`,
      );
    }

    // Verify the role exists and belongs to this tenant or is global
    const role = await this.prisma.role.findFirst({
      where: {
        id: inviteDto.roleId,
        OR: [
          { tenantId: tenantId },
          { tenantId: null },
        ],
      },
    });

    if (!role) {
      throw new NotFoundException(
        `Role with ID '${inviteDto.roleId}' not found or not available for this tenant`,
      );
    }

    // Prevent assigning owner role
    if (role.slug === 'owner') {
      throw new BadRequestException(
        'Cannot invite as owner. Each tenant can only have one owner.',
      );
    }

    // Check if user is already in this tenant
    const existingTenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId: user.id },
      },
    });

    if (existingTenantUser) {
      if (existingTenantUser.status === INVITATION_STATUS.PENDING) {
        throw new ConflictException(
          'User already has a pending invitation to this tenant. Use resend invitation instead.',
        );
      }
      throw new ConflictException(
        'User is already a member of this tenant',
      );
    }

    // Generate invitation code
    const invitationCode = this.generateInvitationCode();

    // Create the tenant user with pending status
    const tenantUser = await this.prisma.tenantUser.create({
      data: {
        tenantId,
        userId: user.id,
        roleId: inviteDto.roleId,
        permissions: inviteDto.permissions || undefined,
        status: INVITATION_STATUS.PENDING,
        invitationCode,
        invitationSentAt: new Date(),
        invitedBy: requestingUserId,
        isActive: false, // Not active until invitation is accepted
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    // TODO: Send invitation email
    // const invitationUrl = `${process.env.FRONTEND_URL}/accept-invitation?code=${invitationCode}`;
    // await this.emailService.sendInvitationEmail({
    //   to: user.email,
    //   tenantName: tenant.name,
    //   inviterName: requestingUser.name,
    //   invitationUrl,
    //   roleName: role.name,
    // });

    return {
      message: `Invitation sent to ${user.email}`,
      tenantUser: {
        id: tenantUser.id,
        status: tenantUser.status,
        invitationSentAt: tenantUser.invitationSentAt,
        user: tenantUser.user,
        role: tenantUser.role,
      },
      // Include invitation code in response for testing purposes
      // In production, this should only be sent via email
      _debug: {
        invitationCode,
        invitationUrl: `${process.env.FRONTEND_URL || 'https://app.htownautos.com'}/accept-invitation?code=${invitationCode}`,
      },
    };
  }

  /**
   * Accept an invitation using the invitation code
   * This endpoint is public (no auth required) - the code itself is the auth
   */
  async acceptInvitation(code: string) {
    // Find the tenant user by invitation code
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: { invitationCode: code },
      include: {
        tenant: true,
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!tenantUser) {
      throw new NotFoundException(
        'Invalid or expired invitation code',
      );
    }

    // Check if already accepted
    if (tenantUser.status === INVITATION_STATUS.ACTIVE) {
      throw new BadRequestException(
        'This invitation has already been accepted',
      );
    }

    // Check if suspended
    if (tenantUser.status === INVITATION_STATUS.SUSPENDED) {
      throw new GoneException(
        'This invitation has been revoked',
      );
    }

    // Optional: Check invitation expiration (e.g., 7 days)
    // const INVITATION_EXPIRY_DAYS = 7;
    // if (tenantUser.invitationSentAt) {
    //   const expiryDate = new Date(tenantUser.invitationSentAt);
    //   expiryDate.setDate(expiryDate.getDate() + INVITATION_EXPIRY_DAYS);
    //   if (new Date() > expiryDate) {
    //     throw new GoneException('This invitation has expired');
    //   }
    // }

    // Accept the invitation
    const updatedTenantUser = await this.prisma.tenantUser.update({
      where: { id: tenantUser.id },
      data: {
        status: INVITATION_STATUS.ACTIVE,
        isActive: true,
        acceptedAt: new Date(),
        invitationCode: null, // Clear the code after use
      },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    return {
      message: `Welcome to ${updatedTenantUser.tenant.name}!`,
      tenantUser: {
        id: updatedTenantUser.id,
        status: updatedTenantUser.status,
        acceptedAt: updatedTenantUser.acceptedAt,
        tenant: updatedTenantUser.tenant,
        user: updatedTenantUser.user,
        role: updatedTenantUser.role,
      },
    };
  }

  /**
   * Resend invitation to a pending user
   * Only the tenant owner can perform this action
   */
  async resendInvitation(
    tenantId: string,
    userId: string,
    requestingUserId: string,
  ) {
    // Verify the tenant exists
    const tenant = await this.findOne(tenantId);

    // Verify the requesting user is the owner
    await this.verifyOwnership(tenantId, requestingUserId);

    // Find the tenant user
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      include: {
        user: true,
        role: true,
      },
    });

    if (!tenantUser) {
      throw new NotFoundException(
        'User is not a member of this tenant',
      );
    }

    // Check if already active
    if (tenantUser.status === INVITATION_STATUS.ACTIVE) {
      throw new BadRequestException(
        'User has already accepted the invitation',
      );
    }

    // Generate new invitation code
    const invitationCode = this.generateInvitationCode();

    // Update with new code
    const updatedTenantUser = await this.prisma.tenantUser.update({
      where: { id: tenantUser.id },
      data: {
        invitationCode,
        invitationSentAt: new Date(),
        status: INVITATION_STATUS.PENDING, // Reset to pending if was suspended
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
    });

    // TODO: Send invitation email
    // const invitationUrl = `${process.env.FRONTEND_URL}/accept-invitation?code=${invitationCode}`;
    // await this.emailService.sendInvitationEmail({
    //   to: tenantUser.user.email,
    //   tenantName: tenant.name,
    //   inviterName: requestingUser.name,
    //   invitationUrl,
    //   roleName: tenantUser.role.name,
    // });

    return {
      message: `Invitation resent to ${updatedTenantUser.user.email}`,
      invitationSentAt: updatedTenantUser.invitationSentAt,
      // Include invitation code in response for testing purposes
      _debug: {
        invitationCode,
        invitationUrl: `${process.env.FRONTEND_URL || 'https://app.htownautos.com'}/accept-invitation?code=${invitationCode}`,
      },
    };
  }

  /**
   * Revoke a pending invitation
   * Only the tenant owner can perform this action
   */
  async revokeInvitation(
    tenantId: string,
    userId: string,
    requestingUserId: string,
  ) {
    // Verify the tenant exists
    await this.findOne(tenantId);

    // Verify the requesting user is the owner
    await this.verifyOwnership(tenantId, requestingUserId);

    // Find the tenant user
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      include: {
        user: true,
      },
    });

    if (!tenantUser) {
      throw new NotFoundException(
        'User is not a member of this tenant',
      );
    }

    // Check if already active
    if (tenantUser.status === INVITATION_STATUS.ACTIVE) {
      throw new BadRequestException(
        'Cannot revoke invitation for an active user. Use remove user instead.',
      );
    }

    // Delete the pending invitation
    await this.prisma.tenantUser.delete({
      where: { id: tenantUser.id },
    });

    return {
      message: `Invitation for ${tenantUser.user.email} has been revoked`,
    };
  }

  /**
   * Get all pending invitations for a tenant
   * Only the tenant owner can view this
   */
  async getPendingInvitations(tenantId: string, requestingUserId: string) {
    // Verify the tenant exists
    await this.findOne(tenantId);

    // Verify the requesting user is the owner
    await this.verifyOwnership(tenantId, requestingUserId);

    return this.prisma.tenantUser.findMany({
      where: {
        tenantId,
        status: INVITATION_STATUS.PENDING,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            name: true,
            firstName: true,
            lastName: true,
          },
        },
        role: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy: {
        invitationSentAt: 'desc',
      },
    });
  }
}
