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
import { SmsService } from './sms.service';
import { CreateSmsDto, UpdateSmsDto } from './dto/create-sms.dto';
import { QuerySmsDto } from './dto/query-sms.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedUser } from '../auth/guards/cognito-jwt.guard';

@ApiTags('SMS Messages')
@ApiBearerAuth()
@Controller('sms')
export class SmsController {
  constructor(private readonly smsService: SmsService) {}

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
    summary: 'Send an SMS message',
    description: 'Records an SMS message sent to a buyer',
  })
  @ApiResponse({ status: 201, description: 'SMS message created successfully' })
  @ApiResponse({ status: 404, description: 'Buyer not found' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() createSmsDto: CreateSmsDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantUserId = this.getTenantUserId(user, tenantId);
    return this.smsService.create(tenantId, createSmsDto, tenantUserId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all SMS messages',
    description: 'Retrieves all SMS messages for the current tenant with optional filters',
  })
  @ApiResponse({ status: 200, description: 'List of SMS messages' })
  findAll(@CurrentTenant() tenantId: string, @Query() query: QuerySmsDto) {
    return this.smsService.findAll(tenantId, query);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get SMS statistics',
    description: 'Retrieves SMS statistics for the tenant, optionally filtered by buyer or sender',
  })
  @ApiResponse({ status: 200, description: 'SMS statistics' })
  getStats(
    @CurrentTenant() tenantId: string,
    @Query('buyerId') buyerId?: string,
    @Query('senderId') senderId?: string,
  ) {
    return this.smsService.getSmsStats(tenantId, buyerId, senderId);
  }

  @Get('by-buyer/:buyerId')
  @ApiOperation({
    summary: 'Get SMS messages by buyer',
    description: 'Retrieves all SMS messages related to a specific buyer',
  })
  @ApiParam({ name: 'buyerId', description: 'Buyer UUID' })
  @ApiResponse({ status: 200, description: 'List of SMS messages for the buyer' })
  findByBuyer(
    @CurrentTenant() tenantId: string,
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
    @Query() query: QuerySmsDto,
  ) {
    return this.smsService.findByBuyer(tenantId, buyerId, query);
  }

  @Get('conversation/:buyerId')
  @ApiOperation({
    summary: 'Get conversation with buyer',
    description: 'Retrieves all SMS messages in a conversation with a specific buyer (chronological order)',
  })
  @ApiParam({ name: 'buyerId', description: 'Buyer UUID' })
  @ApiResponse({ status: 200, description: 'Conversation messages' })
  getConversation(
    @CurrentTenant() tenantId: string,
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
    @Query() query: QuerySmsDto,
  ) {
    return this.smsService.getConversation(tenantId, buyerId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get SMS message by ID',
    description: 'Retrieves a single SMS message by its UUID',
  })
  @ApiParam({ name: 'id', description: 'SMS message UUID' })
  @ApiResponse({ status: 200, description: 'SMS message found' })
  @ApiResponse({ status: 404, description: 'SMS message not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.smsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update SMS message',
    description: 'Updates an SMS message record',
  })
  @ApiParam({ name: 'id', description: 'SMS message UUID' })
  @ApiResponse({ status: 200, description: 'SMS message updated successfully' })
  @ApiResponse({ status: 404, description: 'SMS message not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateSmsDto: UpdateSmsDto,
  ) {
    return this.smsService.update(tenantId, id, updateSmsDto);
  }

  @Patch(':id/read')
  @ApiOperation({
    summary: 'Mark SMS as read',
    description: 'Marks an SMS message as read',
  })
  @ApiParam({ name: 'id', description: 'SMS message UUID' })
  @ApiResponse({ status: 200, description: 'SMS message marked as read' })
  @ApiResponse({ status: 404, description: 'SMS message not found' })
  markAsRead(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.smsService.markAsRead(tenantId, id);
  }

  @Patch('by-buyer/:buyerId/read-all')
  @ApiOperation({
    summary: 'Mark all SMS as read for a buyer',
    description: 'Marks all unread SMS messages from a buyer as read',
  })
  @ApiParam({ name: 'buyerId', description: 'Buyer UUID' })
  @ApiResponse({ status: 200, description: 'All messages marked as read' })
  markAllAsRead(
    @CurrentTenant() tenantId: string,
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
  ) {
    return this.smsService.markAllAsRead(tenantId, buyerId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete SMS message',
    description: 'Permanently deletes an SMS message record',
  })
  @ApiParam({ name: 'id', description: 'SMS message UUID' })
  @ApiResponse({ status: 200, description: 'SMS message deleted successfully' })
  @ApiResponse({ status: 404, description: 'SMS message not found' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.smsService.remove(tenantId, id);
  }
}
