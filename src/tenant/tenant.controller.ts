import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { QueryTenantDto } from './dto/query-tenant.dto';
import {
  AddUserToTenantDto,
  UpdateTenantUserDto,
  InviteUserToTenantDto,
  AcceptInvitationDto,
  ResendInvitationDto,
  RegisterWithInvitationDto,
} from './dto/add-user-to-tenant.dto';
import { Public } from '../auth/decorators/public.decorator';
import { TenantOptional } from '../auth/decorators/tenant-optional.decorator';
import {
  TenantEntity,
  TenantWithStatsEntity,
  PaginatedTenantsEntity,
} from './entities/tenant.entity';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequireRoles, ADMIN_ROLES } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';

@ApiTags('Tenants')
@ApiBearerAuth()
@Controller('tenants')
export class TenantController {
  constructor(private readonly tenantService: TenantService) {}

  @Get('my-tenants')
  @TenantOptional()
  @ApiOperation({
    summary: 'Get current user tenants',
    description: 'Returns all tenants the authenticated user belongs to',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user tenants',
  })
  getMyTenants(@CurrentUser() user: { id: string }) {
    return this.tenantService.getUserTenants(user.id);
  }

  @Post()
  @TenantOptional()
  @ApiOperation({
    summary: 'Create a new tenant',
    description: 'Creates a new tenant (dealership) in the system. The authenticated user becomes the owner of the tenant.',
  })
  @ApiResponse({
    status: 201,
    description: 'Tenant created successfully with the current user as owner',
    type: TenantEntity,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error',
  })
  @ApiResponse({
    status: 409,
    description: 'Tenant with this slug already exists',
  })
  create(
    @Body() createTenantDto: CreateTenantDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.create(createTenantDto, user.id);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all tenants',
    description: 'Retrieves a paginated list of tenants with optional filters',
  })
  @ApiResponse({
    status: 200,
    description: 'List of tenants',
    type: PaginatedTenantsEntity,
  })
  findAll(@Query() query: QueryTenantDto) {
    return this.tenantService.findAll(query);
  }

  @Get('check-slug/:slug')
  @TenantOptional()
  @ApiOperation({
    summary: 'Check slug availability',
    description: 'Checks if a slug is available for use',
  })
  @ApiParam({
    name: 'slug',
    description: 'Slug to check',
    example: 'htown-autos-houston',
  })
  @ApiResponse({
    status: 200,
    description: 'Availability status',
    schema: {
      type: 'object',
      properties: {
        available: { type: 'boolean', example: true },
      },
    },
  })
  checkSlugAvailability(@Param('slug') slug: string) {
    return this.tenantService.checkSlugAvailability(slug);
  }

  @Get('by-slug/:slug')
  @ApiOperation({
    summary: 'Get tenant by slug',
    description: 'Retrieves a tenant by its URL-friendly slug',
  })
  @ApiParam({
    name: 'slug',
    description: 'Tenant slug',
    example: 'htown-autos-houston',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant found',
    type: TenantEntity,
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  findBySlug(@Param('slug') slug: string) {
    return this.tenantService.findBySlug(slug);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get tenant by ID',
    description: 'Retrieves a tenant by its UUID',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant found',
    type: TenantEntity,
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.findOne(id);
  }

  @Get(':id/stats')
  @ApiOperation({
    summary: 'Get tenant with statistics',
    description:
      'Retrieves a tenant with counts of users, vehicles, deals, and buyers',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant with statistics',
    type: TenantWithStatsEntity,
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  findOneWithStats(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.findOneWithStats(id);
  }

  @Get(':id/users')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({
    summary: 'Get tenant users',
    description: 'Retrieves all users associated with a tenant, optionally filtered by role slugs. Requires admin role.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'roles',
    required: false,
    description: 'Comma-separated list of role slugs to filter by (e.g., "owner,salesperson")',
    example: 'owner,salesperson,bdc',
  })
  @ApiResponse({
    status: 200,
    description: 'List of tenant users',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  getUsers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('roles') roles?: string,
  ) {
    const roleSlugs = roles ? roles.split(',').map((r) => r.trim()) : undefined;
    return this.tenantService.getUsers(id, roleSlugs);
  }

  @Get(':id/roles')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({
    summary: 'Get available roles for tenant',
    description: 'Retrieves all roles available for this tenant (global + tenant-specific). Used for invitation role selection. Requires admin role.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'List of available roles',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  getAvailableRoles(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.getAvailableRoles(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update tenant',
    description: 'Updates a tenant by its UUID',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant updated successfully',
    type: TenantEntity,
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  @ApiResponse({
    status: 409,
    description: 'Slug already in use',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTenantDto: UpdateTenantDto,
  ) {
    return this.tenantService.update(id, updateTenantDto);
  }

  @Patch(':id/settings')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @ApiOperation({
    summary: 'Update tenant settings',
    description:
      'Updates tenant settings (merges with existing settings). Requires admin role.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Settings updated successfully',
    type: TenantEntity,
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  updateSettings(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() settings: Record<string, any>,
  ) {
    return this.tenantService.updateSettings(id, settings);
  }

  @Patch(':id/activate')
  @ApiOperation({
    summary: 'Activate tenant',
    description: 'Sets tenant status to active',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant activated',
    type: TenantEntity,
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  activate(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.activate(id);
  }

  @Patch(':id/deactivate')
  @ApiOperation({
    summary: 'Deactivate tenant',
    description: 'Sets tenant status to inactive (soft disable)',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant deactivated',
    type: TenantEntity,
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  deactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenantService.deactivate(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete tenant',
    description:
      'Permanently deletes a tenant. Only the tenant owner can perform this action, and only if tenant has no associated data (other users, vehicles, deals, buyers).',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant deleted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: "Tenant 'HTown Autos' has been successfully deleted" },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete tenant with associated data',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the tenant owner can perform this action',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.remove(id, user.id);
  }

  // ========================================
  // USER MANAGEMENT ENDPOINTS (Owner only)
  // ========================================

  @Post(':id/users')
  @ApiOperation({
    summary: 'Add user to tenant',
    description: 'Adds an existing user to a tenant with a specific role. Only the tenant owner can perform this action.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 201,
    description: 'User added to tenant successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the tenant owner can perform this action',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant, user, or role not found',
  })
  @ApiResponse({
    status: 409,
    description: 'User is already a member of this tenant',
  })
  addUserToTenant(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Body() addUserDto: AddUserToTenantDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.addUserToTenant(tenantId, addUserDto, user.id);
  }

  @Patch(':id/users/:userId')
  @ApiOperation({
    summary: 'Update tenant user',
    description: "Updates a user's role or permissions in a tenant. Only the tenant owner can perform this action.",
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiParam({
    name: 'userId',
    description: 'User UUID to update',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @ApiResponse({
    status: 200,
    description: 'Tenant user updated successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot modify the tenant owner',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the tenant owner can perform this action',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant, user, or role not found',
  })
  updateTenantUser(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() updateDto: UpdateTenantUserDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.updateTenantUser(tenantId, userId, updateDto, user.id);
  }

  @Delete(':id/users/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove user from tenant',
    description: 'Removes a user from a tenant. Only the tenant owner can perform this action.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiParam({
    name: 'userId',
    description: 'User UUID to remove',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @ApiResponse({
    status: 200,
    description: 'User removed from tenant successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: "User 'john@example.com' has been removed from tenant 'HTown Autos'" },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot remove the tenant owner',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the tenant owner can perform this action',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant or user not found',
  })
  removeUserFromTenant(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.removeUserFromTenant(tenantId, userId, user.id);
  }

  @Post(':id/transfer-ownership')
  @ApiOperation({
    summary: 'Transfer tenant ownership',
    description: 'Transfers ownership of a tenant to another user. Only the current owner can perform this action.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Ownership transferred successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Ownership transferred successfully' },
        previousOwnerId: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174001' },
        newOwnerId: { type: 'string', example: '123e4567-e89b-12d3-a456-426614174002' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'New owner must be an existing member of the tenant',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the tenant owner can perform this action',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  transferOwnership(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Body('newOwnerId', ParseUUIDPipe) newOwnerId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.transferOwnership(tenantId, newOwnerId, user.id);
  }

  // ========================================
  // INVITATION ENDPOINTS
  // ========================================

  @Post(':id/invite')
  @ApiOperation({
    summary: 'Invite user to tenant',
    description: 'Invites a user to join a tenant. Sends an invitation email with a verification code. Only the tenant owner can perform this action.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 201,
    description: 'Invitation sent successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Invitation sent to john@example.com' },
        tenantUser: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', example: 'pending' },
            invitationSentAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Only the tenant owner can perform this action',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant, user, or role not found',
  })
  @ApiResponse({
    status: 409,
    description: 'User already has a pending invitation or is already a member',
  })
  inviteUserToTenant(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Body() inviteDto: InviteUserToTenantDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.inviteUserToTenant(tenantId, inviteDto, user.id);
  }

  @Post(':id/invitations/resend')
  @ApiOperation({
    summary: 'Resend invitation',
    description: 'Resends the invitation email to a user with a new verification code. Only the tenant owner can perform this action.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Invitation resent successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'User has already accepted the invitation',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the tenant owner can perform this action',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant or user not found',
  })
  resendInvitation(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Body() resendDto: ResendInvitationDto,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.resendInvitation(tenantId, resendDto.userId, user.id);
  }

  @Delete(':id/invitations/:userId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revoke invitation',
    description: 'Revokes a pending invitation. Only the tenant owner can perform this action.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiParam({
    name: 'userId',
    description: 'User UUID whose invitation to revoke',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @ApiResponse({
    status: 200,
    description: 'Invitation revoked successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Invitation for john@example.com has been revoked' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot revoke invitation for an active user',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the tenant owner can perform this action',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant or user not found',
  })
  revokeInvitation(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.revokeInvitation(tenantId, userId, user.id);
  }

  @Get(':id/invitations/pending')
  @ApiOperation({
    summary: 'Get pending invitations',
    description: 'Retrieves all pending invitations for a tenant. Only the tenant owner can view this.',
  })
  @ApiParam({
    name: 'id',
    description: 'Tenant UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'List of pending invitations',
  })
  @ApiResponse({
    status: 403,
    description: 'Only the tenant owner can perform this action',
  })
  @ApiResponse({
    status: 404,
    description: 'Tenant not found',
  })
  getPendingInvitations(
    @Param('id', ParseUUIDPipe) tenantId: string,
    @CurrentUser() user: { id: string },
  ) {
    return this.tenantService.getPendingInvitations(tenantId, user.id);
  }
}

// ========================================
// PUBLIC INVITATION ACCEPTANCE CONTROLLER
// ========================================

@ApiTags('Invitations')
@Controller('invitations')
export class InvitationController {
  constructor(private readonly tenantService: TenantService) {}

  @Get(':code')
  @Public()
  @ApiOperation({
    summary: 'Get invitation details',
    description: 'Retrieves invitation details by code. Used to show invitation info before accepting.',
  })
  @ApiParam({
    name: 'code',
    description: 'Invitation code',
    example: 'abc123xyz789',
  })
  @ApiResponse({
    status: 200,
    description: 'Invitation details',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', example: 'invitation' },
        id: { type: 'string' },
        email: { type: 'string' },
        tenant: { type: 'object' },
        role: { type: 'object' },
        userExists: { type: 'boolean' },
        requiresRegistration: { type: 'boolean' },
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Invalid or expired invitation code',
  })
  getInvitationDetails(@Param('code') code: string) {
    return this.tenantService.getInvitationByCode(code);
  }

  @Post('accept')
  @Public()
  @ApiOperation({
    summary: 'Accept invitation',
    description: 'Accepts a tenant invitation using the secret code received via email. This endpoint is public.',
  })
  @ApiResponse({
    status: 200,
    description: 'Invitation accepted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Welcome to HTown Autos!' },
        tenantUser: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', example: 'active' },
            acceptedAt: { type: 'string', format: 'date-time' },
            tenant: { type: 'object' },
            user: { type: 'object' },
            role: { type: 'object' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invitation has already been accepted',
  })
  @ApiResponse({
    status: 404,
    description: 'Invalid or expired invitation code',
  })
  @ApiResponse({
    status: 410,
    description: 'Invitation has been revoked',
  })
  acceptInvitation(@Body() acceptDto: AcceptInvitationDto) {
    return this.tenantService.acceptInvitation(acceptDto.code);
  }

  @Post('register')
  @Public()
  @ApiOperation({
    summary: 'Register and accept invitation',
    description:
      'Creates a new user account and accepts the invitation in one step. ' +
      'Creates user in Cognito, creates user in database, and associates with tenant.',
  })
  @ApiResponse({
    status: 201,
    description: 'User registered and invitation accepted successfully',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Account created! Welcome to HTown Autos!' },
        user: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            email: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
          },
        },
        tenantUser: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            status: { type: 'string', example: 'active' },
            acceptedAt: { type: 'string', format: 'date-time' },
            tenant: { type: 'object' },
            role: { type: 'object' },
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Email does not match invitation or password requirements not met',
  })
  @ApiResponse({
    status: 404,
    description: 'Invalid invitation code',
  })
  @ApiResponse({
    status: 409,
    description: 'Account with this email already exists',
  })
  @ApiResponse({
    status: 410,
    description: 'Invitation has been revoked or expired',
  })
  registerAndAcceptInvitation(@Body() registerDto: RegisterWithInvitationDto) {
    return this.tenantService.registerAndAcceptInvitation(registerDto);
  }
}
