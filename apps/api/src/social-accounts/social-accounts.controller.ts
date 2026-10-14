import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import {
  ADMIN_ROLES,
  CurrentTenant,
  CurrentUser,
  RequireApiScopes,
  RequireRoles,
  RolesGuard,
  type AuthenticatedUser,
} from '@htownautos/auth';
import type { AccountType, SocialPlatform } from '@htownautos/social';
import { SocialAccountsService } from './social-accounts.service';
import {
  ConnectSocialAccountDto,
  ConnectBlueskyDto,
  MastodonStartDto,
  WhatsAppEmbeddedSignupDto,
  WhatsAppManualConnectDto,
  ReminderChannelDto,
  UpdateSocialAccountDto,
  CreateSocialGroupDto,
  UpdateSocialGroupDto,
} from './dto';

@ApiTags('Social Accounts')
@ApiBearerAuth()
@Controller('social-accounts')
export class SocialAccountsController {
  constructor(private readonly service: SocialAccountsService) {}

  // ─── OAuth flow ───

  @Get('oauth-url')
  @RequireApiScopes('social-accounts:read')
  @ApiOperation({ summary: 'Signed OAuth authorization URL for a platform' })
  getOAuthUrl(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('platform') platform: SocialPlatform,
    @Query('redirectUri') redirectUri: string,
    @Query('accountType') accountType?: AccountType,
  ) {
    return this.service.getOAuthUrl(tenantId, user.id, platform, redirectUri, accountType);
  }

  // ─── Account list/detail (before groups/:id, boards etc. below) ───

  @Get()
  @RequireApiScopes('social-accounts:read')
  @ApiOperation({ summary: 'List every connected social account' })
  findAll(@CurrentTenant() tenantId: string) {
    return this.service.findAll(tenantId);
  }

  @Get('groups/all')
  @RequireApiScopes('social-accounts:read')
  @ApiOperation({ summary: 'List account groups' })
  findAllGroups(@CurrentTenant() tenantId: string) {
    return this.service.findAllGroups(tenantId);
  }

  // ─── Connect ───

  @Post('connect')
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Exchange an OAuth code (from the signed state) and connect the account(s)' })
  @ApiResponse({ status: 200, description: 'Connected account(s)' })
  connect(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: ConnectSocialAccountDto) {
    return this.service.connect(tenantId, user.id, dto);
  }

  @Post('connect/bluesky')
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Connect a Bluesky account with an app password' })
  connectBluesky(@CurrentTenant() tenantId: string, @Body() dto: ConnectBlueskyDto) {
    return this.service.connectBluesky(tenantId, dto);
  }

  @Post('connect/mastodon/start')
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Register the app on a Mastodon instance and get its OAuth URL' })
  mastodonStart(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: MastodonStartDto) {
    return this.service.mastodonStart(tenantId, user.id, dto);
  }

  @Post('connect/whatsapp')
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'WhatsApp Embedded Signup' })
  connectWhatsApp(@CurrentTenant() tenantId: string, @Body() dto: WhatsAppEmbeddedSignupDto) {
    return this.service.connectWhatsAppEmbedded(tenantId, dto);
  }

  @Post('connect/whatsapp/manual')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Admin-only fallback: connect WhatsApp with a manually issued token' })
  connectWhatsAppManual(@CurrentTenant() tenantId: string, @Body() dto: WhatsAppManualConnectDto) {
    return this.service.connectWhatsAppManual(tenantId, dto);
  }

  @Post('connect/reminder')
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Add a reminder-only channel (no publishing API for this account type)' })
  connectReminder(@CurrentTenant() tenantId: string, @Body() dto: ReminderChannelDto) {
    return this.service.connectReminder(tenantId, dto);
  }

  // ─── Groups CRUD (unchanged surface) ───

  @Post('groups')
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Create a social account group' })
  createGroup(@CurrentTenant() tenantId: string, @Body() dto: CreateSocialGroupDto) {
    return this.service.createGroup(tenantId, dto);
  }

  @Patch('groups/:id')
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Update a social account group' })
  updateGroup(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSocialGroupDto) {
    return this.service.updateGroup(tenantId, id, dto);
  }

  @Delete('groups/:id')
  @HttpCode(HttpStatus.OK)
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Delete a social account group' })
  deleteGroup(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteGroup(tenantId, id);
  }

  // ─── Account detail/mutate (:id — after every static/groups route above) ───

  @Get(':id')
  @RequireApiScopes('social-accounts:read')
  @ApiOperation({ summary: 'Get a social account by id' })
  findOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.findOne(tenantId, id);
  }

  @Get(':id/boards')
  @RequireApiScopes('social-accounts:read')
  @ApiOperation({ summary: 'Pinterest boards for this account' })
  listBoards(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listBoards(tenantId, id);
  }

  @Patch(':id')
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Update name / timezone / queuePaused' })
  update(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSocialAccountDto) {
    return this.service.update(tenantId, id, dto);
  }

  @Post(':id/refresh')
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Force a token refresh' })
  refresh(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.refresh(tenantId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireApiScopes('social-accounts:write')
  @ApiOperation({ summary: 'Soft-disconnect a social account' })
  disconnect(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.disconnect(tenantId, id);
  }
}
