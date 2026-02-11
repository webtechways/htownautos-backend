import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  GoneException,
  Logger,
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
  RegisterWithInvitationDto,
} from './dto/add-user-to-tenant.dto';
import { Prisma } from '@prisma/client';
import { CognitoService } from '../auth/cognito.service';
import { EmailService } from '../email/email.service';

// Invitation status constants
export const INVITATION_STATUS = {
  PENDING: 'pending',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  REMOVED: 'removed',
} as const;

@Injectable()
export class TenantService {
  private readonly logger = new Logger(TenantService.name);

  constructor(
    private prisma: PrismaService,
    private cognitoService: CognitoService,
    private emailService: EmailService,
  ) {}

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

  async getUsers(id: string, roleSlugs?: string[]) {
    await this.findOne(id);

    const where: Prisma.TenantUserWhereInput = {
      tenantId: id,
      // Include both active and pending users
      status: { in: [INVITATION_STATUS.ACTIVE, INVITATION_STATUS.PENDING] },
    };

    // Filter by role slugs if provided
    if (roleSlugs && roleSlugs.length > 0) {
      where.role = {
        slug: { in: roleSlugs },
      };
    }

    return this.prisma.tenantUser.findMany({
      where,
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
      orderBy: [
        { status: 'asc' }, // Active users first, then pending
        { user: { email: 'asc' } },
      ],
    });
  }

  async checkSlugAvailability(slug: string): Promise<{ available: boolean }> {
    const existing = await this.prisma.tenant.findUnique({
      where: { slug },
    });

    return { available: !existing };
  }

  /**
   * Get all tenants the user belongs to
   */
  async getUserTenants(userId: string) {
    const tenantUsers = await this.prisma.tenantUser.findMany({
      where: {
        userId,
        isActive: true,
        status: INVITATION_STATUS.ACTIVE,
      },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            slug: true,
            businessName: true,
            logo: true,
            address: true,
            city: true,
            state: true,
            isActive: true,
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
        tenant: {
          name: 'asc',
        },
      },
    });

    return tenantUsers.map((tu) => ({
      id: tu.tenant.id,
      name: tu.tenant.name,
      slug: tu.tenant.slug,
      businessName: tu.tenant.businessName,
      logo: tu.tenant.logo,
      address: tu.tenant.address,
      city: tu.tenant.city,
      state: tu.tenant.state,
      isActive: tu.tenant.isActive,
      role: tu.role,
      isOwner: tu.role.slug === 'owner',
    }));
  }

  /**
   * Verify if user belongs to a specific tenant
   */
  async verifyUserTenantAccess(userId: string, tenantId: string): Promise<boolean> {
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: {
        tenantId_userId: { tenantId, userId },
      },
    });

    return !!(tenantUser?.isActive && tenantUser?.status === INVITATION_STATUS.ACTIVE);
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

    // Soft delete: update status to removed and deactivate
    await this.prisma.tenantUser.update({
      where: {
        tenantId_userId: { tenantId, userId },
      },
      data: {
        status: INVITATION_STATUS.REMOVED,
        isActive: false,
        removedAt: new Date(),
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

  /**
   * Get available roles for a tenant (global + tenant-specific)
   * Used for invitation role selection
   */
  async getAvailableRoles(tenantId: string) {
    // Verify tenant exists
    await this.findOne(tenantId);

    // Get both global and tenant-specific roles
    const roles = await this.prisma.role.findMany({
      where: {
        OR: [
          { tenantId: tenantId },
          { tenantId: null }, // Global/System roles
        ],
      },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        isSystem: true,
      },
      orderBy: {
        name: 'asc',
      },
    });

    return roles;
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
   * Creates User (if not exists), TenantUser with pending status, and TenantInvitation
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

    // Check if user already exists
    let user = await this.prisma.user.findUnique({
      where: { email: inviteDto.email.toLowerCase() },
    });

    // If user exists, check if already in tenant
    if (user) {
      const existingTenantUser = await this.prisma.tenantUser.findUnique({
        where: {
          tenantId_userId: { tenantId, userId: user.id },
        },
      });

      if (existingTenantUser) {
        // If user was previously removed, we can re-invite them
        if (existingTenantUser.status === INVITATION_STATUS.REMOVED) {
          // Reactivate the existing TenantUser with pending status
          const invitationCode = this.generateInvitationCode();
          const INVITATION_EXPIRY_DAYS = 7;
          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

          const reactivatedTenantUser = await this.prisma.tenantUser.update({
            where: { id: existingTenantUser.id },
            data: {
              roleId: inviteDto.roleId,
              permissions: inviteDto.permissions || undefined,
              status: INVITATION_STATUS.PENDING,
              isActive: false,
              invitationCode,
              invitationSentAt: new Date(),
              invitedBy: requestingUserId,
              removedAt: null, // Clear removal timestamp
              acceptedAt: null, // Clear previous acceptance
            },
            include: {
              role: { select: { id: true, name: true, slug: true } },
            },
          });

          // Build invitation URL
          const invitationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/accept-invitation?code=${invitationCode}`;

          console.log('\n========================================');
          console.log('📧 RE-INVITATION SENT (Previously Removed User)');
          console.log('========================================');
          console.log(`To: ${user.email}`);
          console.log(`Tenant: ${tenant.name}`);
          console.log(`Role: ${role.name}`);
          console.log(`Expires: ${expiresAt.toLocaleDateString()} (${INVITATION_EXPIRY_DAYS} days)`);
          console.log(`Invitation URL: ${invitationUrl}`);
          console.log('========================================\n');

          // Send re-invitation email
          await this.emailService.sendInvitationEmail({
            to: user.email,
            tenantName: tenant.name,
            roleName: role.name,
            invitationUrl,
            expiresAt,
          });

          return {
            message: `Re-invitation sent to ${user.email}`,
            invitation: {
              id: reactivatedTenantUser.id,
              email: user.email,
              status: INVITATION_STATUS.PENDING,
              invitationSentAt: reactivatedTenantUser.invitationSentAt,
              role: reactivatedTenantUser.role,
            },
            user: {
              id: user.id,
              email: user.email,
            },
            _debug: {
              invitationCode,
              invitationUrl,
            },
          };
        }

        if (existingTenantUser.status === INVITATION_STATUS.PENDING) {
          throw new ConflictException(
            'User already has a pending invitation to this tenant.',
          );
        }
        if (existingTenantUser.status === INVITATION_STATUS.SUSPENDED) {
          throw new ConflictException(
            'This user is suspended from this tenant.',
          );
        }
        throw new ConflictException(
          'User is already a member of this tenant',
        );
      }
    }

    // Check for existing pending invitation
    const existingInvitation = await this.prisma.tenantInvitation.findUnique({
      where: {
        tenantId_email: { tenantId, email: inviteDto.email.toLowerCase() },
      },
    });

    if (existingInvitation && existingInvitation.status === 'pending') {
      throw new ConflictException(
        'An invitation has already been sent to this email. Use resend invitation instead.',
      );
    }

    // Generate invitation code and expiration (7 days)
    const invitationCode = this.generateInvitationCode();
    const INVITATION_EXPIRY_DAYS = 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

    // Create User, TenantUser, and TenantInvitation in a transaction
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Create user if doesn't exist (without cognitoSub - will be set when they register)
      if (!user) {
        user = await tx.user.create({
          data: {
            email: inviteDto.email.toLowerCase(),
            cognitoSub: null, // Will be set when user registers/accepts
            isActive: true,
            emailVerified: false,
          },
        });
        this.logger.log(`Created pending user with ID: ${user.id} for email: ${inviteDto.email}`);
      }

      // Create TenantUser with pending status
      const tenantUser = await tx.tenantUser.create({
        data: {
          tenantId,
          userId: user.id,
          roleId: inviteDto.roleId,
          permissions: inviteDto.permissions || undefined,
          status: INVITATION_STATUS.PENDING,
          isActive: false, // Will be set to true when accepted
          invitationCode,
          invitationSentAt: new Date(),
          invitedBy: requestingUserId,
        },
      });

      // Create or update the invitation record for tracking
      const invitation = await tx.tenantInvitation.upsert({
        where: {
          tenantId_email: { tenantId, email: inviteDto.email.toLowerCase() },
        },
        update: {
          roleId: inviteDto.roleId,
          permissions: inviteDto.permissions || undefined,
          invitationCode,
          invitationSentAt: new Date(),
          expiresAt,
          invitedBy: requestingUserId,
          status: 'pending',
          acceptedAt: null,
        },
        create: {
          tenantId,
          email: inviteDto.email.toLowerCase(),
          roleId: inviteDto.roleId,
          permissions: inviteDto.permissions || undefined,
          invitationCode,
          expiresAt,
          invitedBy: requestingUserId,
          status: 'pending',
        },
        include: {
          role: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      });

      return { user, tenantUser, invitation };
    });

    // Build invitation URL
    const invitationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/accept-invitation?code=${invitationCode}`;

    // Log invitation URL to console (in production, this would be sent via email)
    console.log('\n========================================');
    console.log('📧 INVITATION SENT');
    console.log('========================================');
    console.log(`To: ${inviteDto.email}`);
    console.log(`Tenant: ${tenant.name}`);
    console.log(`Role: ${role.name}`);
    console.log(`User ID: ${result.user.id}`);
    console.log(`TenantUser Status: ${INVITATION_STATUS.PENDING}`);
    console.log(`Expires: ${expiresAt.toLocaleDateString()} (${INVITATION_EXPIRY_DAYS} days)`);
    console.log(`Invitation URL: ${invitationUrl}`);
    console.log('========================================\n');

    // Send invitation email
    await this.emailService.sendInvitationEmail({
      to: inviteDto.email,
      tenantName: tenant.name,
      roleName: role.name,
      invitationUrl,
      expiresAt,
    });

    return {
      message: `Invitation sent to ${inviteDto.email}`,
      invitation: {
        id: result.invitation.id,
        email: result.invitation.email,
        status: result.invitation.status,
        invitationSentAt: result.invitation.invitationSentAt,
        role: result.invitation.role,
      },
      user: {
        id: result.user.id,
        email: result.user.email,
      },
      // Include invitation code in response for testing purposes
      // In production, this should only be sent via email
      _debug: {
        invitationCode,
        invitationUrl,
      },
    };
  }

  /**
   * Get invitation details by code (public - no auth required)
   * Used to show invitation info before accepting
   */
  async getInvitationByCode(code: string) {
    // First check TenantUser table (primary source in new flow)
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: { invitationCode: code },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, email: true, name: true, cognitoSub: true } },
        role: { select: { id: true, name: true, slug: true } },
      },
    });

    if (tenantUser) {
      if (tenantUser.status === INVITATION_STATUS.ACTIVE) {
        throw new BadRequestException('This invitation has already been accepted');
      }
      if (tenantUser.status === INVITATION_STATUS.SUSPENDED) {
        throw new GoneException('This invitation has been revoked');
      }

      // Check if user has Cognito account (cognitoSub set)
      // If not, they need to register
      const requiresRegistration = !tenantUser.user.cognitoSub;

      return {
        type: 'tenantUser',
        id: tenantUser.id,
        email: tenantUser.user.email,
        tenant: tenantUser.tenant,
        role: tenantUser.role,
        userExists: true, // User record exists (created during invitation)
        requiresRegistration, // But may need to create Cognito account
      };
    }

    // Fallback: check TenantInvitation table (for backward compatibility)
    const invitation = await this.prisma.tenantInvitation.findUnique({
      where: { invitationCode: code },
      include: {
        tenant: {
          select: { id: true, name: true, slug: true },
        },
        role: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    if (invitation) {
      if (invitation.status === 'accepted') {
        throw new BadRequestException('This invitation has already been accepted');
      }
      if (invitation.status === 'revoked') {
        throw new GoneException('This invitation has been revoked');
      }
      // Check expiration
      if (invitation.expiresAt && new Date() > invitation.expiresAt) {
        throw new GoneException('This invitation has expired');
      }

      // Check if user exists and has Cognito account
      const user = await this.prisma.user.findUnique({
        where: { email: invitation.email },
      });

      return {
        type: 'invitation',
        id: invitation.id,
        email: invitation.email,
        tenant: invitation.tenant,
        role: invitation.role,
        userExists: !!user,
        requiresRegistration: !user || !user.cognitoSub,
      };
    }

    throw new NotFoundException('Invalid or expired invitation code');
  }

  /**
   * Accept an invitation using the invitation code
   * User must already have a Cognito account (cognitoSub set)
   * Updates TenantUser status from pending to active
   */
  async acceptInvitation(code: string) {
    // Find TenantUser by invitation code
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: { invitationCode: code },
      include: {
        tenant: true,
        user: true,
        role: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!tenantUser) {
      throw new NotFoundException('Invalid or expired invitation code');
    }

    if (tenantUser.status === INVITATION_STATUS.ACTIVE) {
      throw new BadRequestException('This invitation has already been accepted');
    }

    if (tenantUser.status === INVITATION_STATUS.SUSPENDED) {
      throw new GoneException('This invitation has been revoked');
    }

    // Check if user has Cognito account (cognitoSub set)
    // If not, they need to register first
    if (!tenantUser.user.cognitoSub) {
      return {
        requiresRegistration: true,
        email: tenantUser.user.email,
        tenant: { id: tenantUser.tenant.id, name: tenantUser.tenant.name },
        role: tenantUser.role,
        message: 'Please create an account to accept this invitation',
      };
    }

    // Accept invitation - update TenantUser status to active
    const updatedTenantUser = await this.prisma.tenantUser.update({
      where: { id: tenantUser.id },
      data: {
        status: INVITATION_STATUS.ACTIVE,
        isActive: true,
        acceptedAt: new Date(),
        invitationCode: null, // Clear the code after use
      },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        user: { select: { id: true, email: true, name: true } },
        role: { select: { id: true, name: true, slug: true } },
      },
    });

    // Also update TenantInvitation status if exists
    await this.prisma.tenantInvitation.updateMany({
      where: {
        tenantId: tenantUser.tenantId,
        email: tenantUser.user.email,
        status: 'pending',
      },
      data: {
        status: 'accepted',
        acceptedAt: new Date(),
      },
    });

    this.logger.log(`Invitation accepted for ${tenantUser.user.email} in tenant ${updatedTenantUser.tenant.name}`);

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
   * Register a new user and accept invitation in one step
   * User record already exists (created during invitation with cognitoSub: null)
   * TenantUser record already exists with pending status
   * This method:
   * 1. Creates user in Cognito
   * 2. Updates existing User with cognitoSub and profile info
   * 3. Updates existing TenantUser status from pending to active
   */
  async registerAndAcceptInvitation(registerDto: RegisterWithInvitationDto) {
    const { code, email, password, firstName, lastName } = registerDto;

    this.logger.log('========================================');
    this.logger.log('REGISTERING NEW USER VIA INVITATION');
    this.logger.log('========================================');
    this.logger.log(`Email: ${email}`);
    this.logger.log(`Name: ${firstName} ${lastName}`);

    // Step 1: Find the TenantUser by invitation code
    const tenantUser = await this.prisma.tenantUser.findUnique({
      where: { invitationCode: code },
      include: {
        tenant: true,
        user: true,
        role: { select: { id: true, name: true, slug: true } },
      },
    });

    if (!tenantUser) {
      throw new NotFoundException('Invalid invitation code');
    }

    if (tenantUser.status === INVITATION_STATUS.ACTIVE) {
      throw new BadRequestException('This invitation has already been accepted');
    }

    if (tenantUser.status === INVITATION_STATUS.SUSPENDED) {
      throw new GoneException('This invitation has been revoked');
    }

    // Verify email matches the user associated with the invitation
    if (email.toLowerCase() !== tenantUser.user.email.toLowerCase()) {
      throw new BadRequestException(
        'Email does not match the invitation. Please use the email the invitation was sent to.',
      );
    }

    // Step 2: Check if user already has a Cognito account
    if (tenantUser.user.cognitoSub) {
      throw new ConflictException(
        'This user already has an account. Please log in to accept the invitation.',
      );
    }

    // Step 3: Create user in Cognito
    const cognitoResult = await this.cognitoService.createUser({
      email,
      password,
      firstName,
      lastName,
    });

    this.logger.log(`Cognito user created with sub: ${cognitoResult.cognitoSub}`);

    // Step 4: Update existing User and TenantUser in a transaction
    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Update existing user with Cognito sub and profile info
      const updatedUser = await tx.user.update({
        where: { id: tenantUser.user.id },
        data: {
          cognitoSub: cognitoResult.cognitoSub,
          firstName,
          lastName,
          name: `${firstName} ${lastName}`,
          emailVerified: true,
          isActive: true,
        },
      });

      this.logger.log(`User updated in database with ID: ${updatedUser.id}`);

      // Update TenantUser status from pending to active
      const updatedTenantUser = await tx.tenantUser.update({
        where: { id: tenantUser.id },
        data: {
          status: INVITATION_STATUS.ACTIVE,
          isActive: true,
          acceptedAt: new Date(),
          invitationCode: null, // Clear the code after use
        },
        include: {
          tenant: { select: { id: true, name: true, slug: true } },
          user: { select: { id: true, email: true, name: true, firstName: true, lastName: true } },
          role: { select: { id: true, name: true, slug: true } },
        },
      });

      // Also update TenantInvitation status if exists
      await tx.tenantInvitation.updateMany({
        where: {
          tenantId: tenantUser.tenantId,
          email: tenantUser.user.email,
          status: 'pending',
        },
        data: {
          status: 'accepted',
          acceptedAt: new Date(),
        },
      });

      return { user: updatedUser, tenantUser: updatedTenantUser };
    });

    this.logger.log('========================================');
    this.logger.log('REGISTRATION COMPLETE');
    this.logger.log(`User ID: ${result.user.id}`);
    this.logger.log(`Tenant: ${result.tenantUser.tenant.name}`);
    this.logger.log(`Role: ${result.tenantUser.role.name}`);
    this.logger.log('========================================');

    return {
      message: `Account created! Welcome to ${result.tenantUser.tenant.name}!`,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
      },
      tenantUser: {
        id: result.tenantUser.id,
        status: result.tenantUser.status,
        acceptedAt: result.tenantUser.acceptedAt,
        tenant: result.tenantUser.tenant,
        role: result.tenantUser.role,
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

    // Generate new invitation code and expiration (7 days)
    const invitationCode = this.generateInvitationCode();
    const INVITATION_EXPIRY_DAYS = 7;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITATION_EXPIRY_DAYS);

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

    // Build invitation URL
    const invitationUrl = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/accept-invitation?code=${invitationCode}`;

    // Log invitation URL to console (in production, this would be sent via email)
    console.log('\n========================================');
    console.log('📧 INVITATION RESENT');
    console.log('========================================');
    console.log(`To: ${updatedTenantUser.user.email}`);
    console.log(`Tenant: ${tenant.name}`);
    console.log(`Role: ${tenantUser.role.name}`);
    console.log(`Expires: ${expiresAt.toLocaleDateString()} (${INVITATION_EXPIRY_DAYS} days)`);
    console.log(`Invitation URL: ${invitationUrl}`);
    console.log('========================================\n');

    // Send resend invitation email
    await this.emailService.sendInvitationEmail({
      to: updatedTenantUser.user.email,
      tenantName: tenant.name,
      roleName: tenantUser.role.name,
      invitationUrl,
      expiresAt,
    });

    return {
      message: `Invitation resent to ${updatedTenantUser.user.email}`,
      invitationSentAt: updatedTenantUser.invitationSentAt,
      // Include invitation code in response for testing purposes
      _debug: {
        invitationCode,
        invitationUrl,
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
