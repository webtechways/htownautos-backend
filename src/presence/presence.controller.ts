import { Controller, Get, Param, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CognitoJwtGuard } from '../auth/guards/cognito-jwt.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { PresenceService, UserPresence } from './presence.service';

@ApiTags('Presence')
@ApiBearerAuth()
@UseGuards(CognitoJwtGuard, TenantGuard)
@Controller('presence')
export class PresenceController {
  constructor(private readonly presenceService: PresenceService) {}

  @Get('tenant/:tenantId/users')
  @ApiOperation({
    summary: 'Get all users presence status for a tenant',
    description: 'Returns the online/offline status and last seen time for all users in a tenant',
  })
  @ApiParam({
    name: 'tenantId',
    description: 'Tenant UUID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user presence statuses',
  })
  async getTenantUsersPresence(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<{ users: UserPresence[] }> {
    const users = await this.presenceService.getTenantUsersPresence(tenantId);
    return { users };
  }

  @Get('tenant/:tenantId/online')
  @ApiOperation({
    summary: 'Get online users for a tenant',
    description: 'Returns only the currently online users for a tenant',
  })
  @ApiParam({
    name: 'tenantId',
    description: 'Tenant UUID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of online users',
  })
  async getOnlineUsers(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
  ): Promise<{ users: UserPresence[] }> {
    const users = await this.presenceService.getOnlineUsers(tenantId);
    return { users };
  }

  @Get('tenant/:tenantId/user/:userId')
  @ApiOperation({
    summary: 'Check if a specific user is online',
  })
  @ApiParam({ name: 'tenantId', description: 'Tenant UUID' })
  @ApiParam({ name: 'userId', description: 'User UUID' })
  @ApiResponse({
    status: 200,
    description: 'User online status',
  })
  async isUserOnline(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<{ userId: string; isOnline: boolean }> {
    const isOnline = await this.presenceService.isUserOnline(userId, tenantId);
    return { userId, isOnline };
  }
}
