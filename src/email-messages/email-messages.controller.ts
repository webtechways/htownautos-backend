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
  BadRequestException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { EmailMessagesService } from './email-messages.service';
import { CreateEmailMessageDto, UpdateEmailMessageDto } from './dto/create-email-message.dto';
import { QueryEmailMessageDto } from './dto/query-email-message.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedUser } from '../auth/guards/cognito-jwt.guard';

@ApiTags('Email Messages')
@ApiBearerAuth()
@Controller('email-messages')
export class EmailMessagesController {
  constructor(private readonly emailMessagesService: EmailMessagesService) {}

  private getTenantUserId(user: AuthenticatedUser, tenantId: string): string {
    const tenantUser = user.tenants?.find(
      (t) => t.tenantId === tenantId || t.tenant?.id === tenantId,
    );
    if (!tenantUser) {
      throw new BadRequestException('User is not a member of this tenant');
    }
    return tenantUser.id;
  }

  @Post()
  @ApiOperation({
    summary: 'Create an email message',
    description: 'Records an email message sent to or received from a buyer',
  })
  @ApiResponse({ status: 201, description: 'Email message created successfully' })
  @ApiResponse({ status: 404, description: 'Buyer not found' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() createEmailMessageDto: CreateEmailMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantUserId = this.getTenantUserId(user, tenantId);
    return this.emailMessagesService.create(tenantId, createEmailMessageDto, tenantUserId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all email messages',
    description: 'Retrieves all email messages for the current tenant with optional filters',
  })
  @ApiResponse({ status: 200, description: 'List of email messages' })
  findAll(@CurrentTenant() tenantId: string, @Query() query: QueryEmailMessageDto) {
    return this.emailMessagesService.findAll(tenantId, query);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get email statistics',
    description: 'Retrieves email statistics for the tenant, optionally filtered by buyer or sender',
  })
  @ApiResponse({ status: 200, description: 'Email statistics' })
  getStats(
    @CurrentTenant() tenantId: string,
    @Query('buyerId') buyerId?: string,
    @Query('senderId') senderId?: string,
  ) {
    return this.emailMessagesService.getEmailStats(tenantId, buyerId, senderId);
  }

  @Get('by-buyer/:buyerId')
  @ApiOperation({
    summary: 'Get email messages by buyer',
    description: 'Retrieves all email messages related to a specific buyer',
  })
  @ApiParam({ name: 'buyerId', description: 'Buyer UUID' })
  @ApiResponse({ status: 200, description: 'List of email messages for the buyer' })
  findByBuyer(
    @CurrentTenant() tenantId: string,
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
    @Query() query: QueryEmailMessageDto,
  ) {
    return this.emailMessagesService.findByBuyer(tenantId, buyerId, query);
  }

  @Get('thread/:threadId')
  @ApiOperation({
    summary: 'Get email thread',
    description: 'Retrieves all emails in a specific thread (chronological order)',
  })
  @ApiParam({ name: 'threadId', description: 'Thread ID' })
  @ApiResponse({ status: 200, description: 'Thread emails' })
  getThread(
    @CurrentTenant() tenantId: string,
    @Param('threadId') threadId: string,
    @Query() query: QueryEmailMessageDto,
  ) {
    return this.emailMessagesService.getThread(tenantId, threadId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get email message by ID',
    description: 'Retrieves a single email message by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Email message UUID' })
  @ApiResponse({ status: 200, description: 'Email message found' })
  @ApiResponse({ status: 404, description: 'Email message not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.emailMessagesService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update email message',
    description: 'Updates an email message record',
  })
  @ApiParam({ name: 'id', description: 'Email message UUID' })
  @ApiResponse({ status: 200, description: 'Email message updated successfully' })
  @ApiResponse({ status: 404, description: 'Email message not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateEmailMessageDto: UpdateEmailMessageDto,
  ) {
    return this.emailMessagesService.update(tenantId, id, updateEmailMessageDto);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark email as read',
    description: 'Marks an email message as read',
  })
  @ApiParam({ name: 'id', description: 'Email message UUID' })
  @ApiResponse({ status: 200, description: 'Email message marked as read' })
  @ApiResponse({ status: 404, description: 'Email message not found' })
  markAsRead(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.emailMessagesService.markAsRead(tenantId, id);
  }

  @Patch('by-buyer/:buyerId/read-all')
  @ApiOperation({
    summary: 'Mark all emails as read for a buyer',
    description: 'Marks all unread emails from a buyer as read',
  })
  @ApiParam({ name: 'buyerId', description: 'Buyer UUID' })
  @ApiResponse({ status: 200, description: 'All emails marked as read' })
  markAllAsRead(
    @CurrentTenant() tenantId: string,
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
  ) {
    return this.emailMessagesService.markAllAsRead(tenantId, buyerId);
  }

  @Patch(':id/track-open')
  @ApiOperation({
    summary: 'Track email open',
    description: 'Increments the open count for an email (for tracking pixels)',
  })
  @ApiParam({ name: 'id', description: 'Email message UUID' })
  @ApiResponse({ status: 200, description: 'Open tracked' })
  trackOpen(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.emailMessagesService.trackOpen(tenantId, id);
  }

  @Patch(':id/track-click')
  @ApiOperation({
    summary: 'Track email click',
    description: 'Increments the click count for an email',
  })
  @ApiParam({ name: 'id', description: 'Email message UUID' })
  @ApiResponse({ status: 200, description: 'Click tracked' })
  trackClick(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.emailMessagesService.trackClick(tenantId, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete email message',
    description: 'Permanently deletes an email message record',
  })
  @ApiParam({ name: 'id', description: 'Email message UUID' })
  @ApiResponse({ status: 200, description: 'Email message deleted successfully' })
  @ApiResponse({ status: 404, description: 'Email message not found' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.emailMessagesService.remove(tenantId, id);
  }
}
