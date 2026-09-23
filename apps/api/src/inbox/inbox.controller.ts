import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMIN_ROLES, CurrentTenant, CurrentUser, RequireApiScopes, RequireRoles, RolesGuard, type AuthenticatedUser } from '@htownautos/auth';
import { InboxService } from './inbox.service';
import { ConversationListQueryDto, MessagePageQueryDto, SendMessageDto, StartConversationDto, UpdateConversationDto } from './dto';

@ApiTags('Inbox')
@ApiBearerAuth()
@Controller('inbox')
export class InboxController {
  constructor(private readonly service: InboxService) {}

  @Get('conversations')
  @RequireApiScopes('inbox:read')
  @ApiOperation({ summary: 'List inbox conversations' })
  list(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Query() query: ConversationListQueryDto) {
    return this.service.list(tenantId, user.id, query);
  }

  @Get('unread-count')
  @RequireApiScopes('inbox:read')
  @ApiOperation({ summary: 'Unread message counts, total and by channel' })
  unreadCount(@CurrentTenant() tenantId: string) {
    return this.service.unreadCount(tenantId);
  }

  @Get('senders')
  @RequireApiScopes('inbox:read')
  @ApiOperation({ summary: 'Twilio numbers + connected accounts that can send/receive inbox messages' })
  listSenders(@CurrentTenant() tenantId: string) {
    return this.service.listSenders(tenantId);
  }

  @Get('whatsapp/templates')
  @RequireApiScopes('inbox:read')
  @ApiOperation({ summary: 'Approved WhatsApp message templates for a connected WhatsApp Cloud sender' })
  listWhatsAppTemplates(@CurrentTenant() tenantId: string, @Query('senderId', ParseUUIDPipe) senderId: string) {
    return this.service.listWhatsAppTemplates(tenantId, senderId);
  }

  @Post('twilio/sync-webhooks')
  @UseGuards(RolesGuard)
  @RequireRoles(...ADMIN_ROLES)
  @RequireApiScopes('inbox:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Point every tenant Twilio number's SMS URL + status callback at our webhook" })
  syncTwilioWebhooks(@CurrentTenant() tenantId: string) {
    return this.service.syncTwilioWebhooks(tenantId);
  }

  @Post('conversations')
  @RequireApiScopes('inbox:write')
  @ApiOperation({ summary: 'Start a new SMS or WhatsApp conversation' })
  startConversation(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Body() dto: StartConversationDto) {
    return this.service.startConversation(tenantId, user.id, dto);
  }

  @Get('conversations/:id')
  @RequireApiScopes('inbox:read')
  @ApiOperation({ summary: 'Get one conversation' })
  getOne(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getOne(tenantId, id);
  }

  @Get('conversations/:id/messages')
  @RequireApiScopes('inbox:read')
  @ApiOperation({ summary: 'Page of messages in a conversation, newest last' })
  getMessages(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Query() query: MessagePageQueryDto) {
    return this.service.getMessages(tenantId, id, query);
  }

  @Post('conversations/:id/messages')
  @RequireApiScopes('inbox:write')
  @ApiOperation({ summary: 'Send a message in an existing conversation' })
  sendMessage(@CurrentTenant() tenantId: string, @CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return this.service.sendMessage(tenantId, user.id, id, dto);
  }

  @Post('conversations/:id/read')
  @RequireApiScopes('inbox:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a conversation as read (unreadCount → 0)' })
  markRead(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.markRead(tenantId, id);
  }

  @Patch('conversations/:id')
  @RequireApiScopes('inbox:write')
  @ApiOperation({ summary: 'Update status, assignee or linked buyer' })
  update(@CurrentTenant() tenantId: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConversationDto) {
    return this.service.updateConversation(tenantId, id, dto);
  }
}
