import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_ROLES,
  CurrentTenant,
  CurrentUser,
  RequireApiScopes,
  RequireRoles,
  RolesGuard,
  type AuthenticatedUser,
} from '@htownautos/auth';
import { SocialSettingsService } from './social-settings.service';
import { UpdateSocialSettingsDto } from './dto/update-social-settings.dto';

@ApiTags('social-settings')
@Controller('social/settings')
export class SocialSettingsController {
  constructor(private readonly settingsService: SocialSettingsService) {}

  @Get()
  @RequireApiScopes('social:read')
  @ApiOperation({ summary: 'Get the tenant Social Suite settings (lazy-created on first read)' })
  get(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.settingsService.get(tenantId, user);
  }

  @Patch()
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @RequireApiScopes('social:write')
  @ApiOperation({ summary: 'Update the tenant Social Suite settings (admin only)' })
  update(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSocialSettingsDto,
  ) {
    return this.settingsService.update(tenantId, user, dto);
  }
}
