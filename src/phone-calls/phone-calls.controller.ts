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
import { PhoneCallsService } from './phone-calls.service';
import { PhoneCallService } from '../phone-call/phone-call.service';
import { CreatePhoneCallDto, UpdatePhoneCallDto } from './dto/create-phone-call.dto';
import { QueryPhoneCallDto } from './dto/query-phone-call.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedUser } from '../auth/guards/cognito-jwt.guard';

@ApiTags('Phone Calls')
@ApiBearerAuth()
@Controller('phone-calls')
export class PhoneCallsController {
  constructor(
    private readonly phoneCallsService: PhoneCallsService,
    private readonly phoneCallService: PhoneCallService,
  ) {}

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
    summary: 'Log a phone call',
    description: 'Records a phone call between a user and a buyer',
  })
  @ApiResponse({ status: 201, description: 'Phone call logged successfully' })
  @ApiResponse({ status: 404, description: 'Buyer not found' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() createPhoneCallDto: CreatePhoneCallDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantUserId = this.getTenantUserId(user, tenantId);
    return this.phoneCallsService.create(tenantId, createPhoneCallDto, tenantUserId);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all phone calls',
    description: 'Retrieves all phone calls for the current tenant with optional filters',
  })
  @ApiResponse({ status: 200, description: 'List of phone calls' })
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: QueryPhoneCallDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const canAccessRecordings = await this.phoneCallsService.canUserAccessRecordings(tenantId, user.id);
    return this.phoneCallsService.findAll(tenantId, query, canAccessRecordings);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get call statistics',
    description: 'Retrieves call statistics for the tenant, optionally filtered by buyer or caller',
  })
  @ApiResponse({ status: 200, description: 'Call statistics' })
  getStats(
    @CurrentTenant() tenantId: string,
    @Query('buyerId') buyerId?: string,
    @Query('callerId') callerId?: string,
  ) {
    return this.phoneCallsService.getCallStats(tenantId, buyerId, callerId);
  }

  @Get('by-buyer/:buyerId')
  @ApiOperation({
    summary: 'Get phone calls by buyer',
    description: 'Retrieves all phone calls related to a specific buyer',
  })
  @ApiParam({ name: 'buyerId', description: 'Buyer UUID' })
  @ApiResponse({ status: 200, description: 'List of phone calls for the buyer' })
  async findByBuyer(
    @CurrentTenant() tenantId: string,
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
    @Query() query: QueryPhoneCallDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const canAccessRecordings = await this.phoneCallsService.canUserAccessRecordings(tenantId, user.id);
    return this.phoneCallsService.findByBuyer(tenantId, buyerId, query, canAccessRecordings);
  }

  @Get('by-phone-numbers')
  @ApiOperation({
    summary: 'Get phone calls by phone numbers',
    description: 'Retrieves all phone calls where fromNumber or toNumber matches any of the provided numbers',
  })
  @ApiResponse({ status: 200, description: 'List of phone calls matching the phone numbers' })
  async findByPhoneNumbers(
    @CurrentTenant() tenantId: string,
    @Query('phones') phones: string,
    @Query() query: QueryPhoneCallDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    // phones is a comma-separated list of phone numbers
    const phoneNumbers = phones ? phones.split(',').map((p) => p.trim()) : [];
    const canAccessRecordings = await this.phoneCallsService.canUserAccessRecordings(tenantId, user.id);
    return this.phoneCallsService.findByPhoneNumbers(tenantId, phoneNumbers, query, canAccessRecordings);
  }

  @Get('transfer/available-users')
  @ApiOperation({
    summary: 'Get available users for call transfer',
    description: 'Returns list of active users in the tenant who can receive transferred calls',
  })
  @ApiResponse({ status: 200, description: 'List of available transfer targets' })
  async getAvailableTransferTargets(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantUserId = this.getTenantUserId(user, tenantId);
    return this.phoneCallService.getAvailableTransferTargets(tenantId, tenantUserId);
  }

  @Post('transfer/:callSid')
  @ApiOperation({
    summary: 'Transfer an active call',
    description: 'Transfers an active call to another user in the tenant',
  })
  @ApiParam({ name: 'callSid', description: 'Twilio Call SID of the active call' })
  @ApiResponse({ status: 200, description: 'Call transferred successfully' })
  @ApiResponse({ status: 400, description: 'Call not found or not active' })
  async transferCall(
    @CurrentTenant() tenantId: string,
    @Param('callSid') callSid: string,
    @Body() body: { targetUserId: string; reason?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantUserId = this.getTenantUserId(user, tenantId);

    if (!body.targetUserId) {
      throw new BadRequestException('targetUserId is required');
    }

    return this.phoneCallService.transferCall(
      callSid,
      body.targetUserId,
      tenantUserId,
      body.reason,
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get phone call by ID',
    description: 'Retrieves a single phone call by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Phone call UUID' })
  @ApiResponse({ status: 200, description: 'Phone call found' })
  @ApiResponse({ status: 404, description: 'Phone call not found' })
  async findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const canAccessRecordings = await this.phoneCallsService.canUserAccessRecordings(tenantId, user.id);
    return this.phoneCallsService.findOne(tenantId, id, canAccessRecordings);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update phone call',
    description: 'Updates a phone call record',
  })
  @ApiParam({ name: 'id', description: 'Phone call UUID' })
  @ApiResponse({ status: 200, description: 'Phone call updated successfully' })
  @ApiResponse({ status: 404, description: 'Phone call not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePhoneCallDto: UpdatePhoneCallDto,
  ) {
    return this.phoneCallsService.update(tenantId, id, updatePhoneCallDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete phone call',
    description: 'Permanently deletes a phone call record',
  })
  @ApiParam({ name: 'id', description: 'Phone call UUID' })
  @ApiResponse({ status: 200, description: 'Phone call deleted successfully' })
  @ApiResponse({ status: 404, description: 'Phone call not found' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.phoneCallsService.remove(tenantId, id);
  }

  @Post('resegment-transcription/:callSid')
  @ApiOperation({
    summary: 'Re-segment transcription for a call with transfers',
    description:
      'Re-processes the transcription to split it across transfer segments based on their time ranges. Useful for fixing calls processed before this feature.',
  })
  @ApiParam({ name: 'callSid', description: 'Any Twilio Call SID in the call chain (original or transfer)' })
  @ApiResponse({ status: 200, description: 'Transcription re-segmented successfully' })
  async resegmentTranscription(
    @Param('callSid') callSid: string,
  ) {
    const segmentsUpdated = await this.phoneCallService.resegmentTranscription(callSid);
    return {
      success: true,
      segmentsUpdated,
      message: `Transcription re-segmented for ${segmentsUpdated} call segments`,
    };
  }

  @Post('resegment-all-transcriptions')
  @ApiOperation({
    summary: 'Re-segment all transcriptions for calls with transfers',
    description:
      'Re-processes transcriptions for all calls with transfers in the tenant. This can take a while for tenants with many calls.',
  })
  @ApiResponse({ status: 200, description: 'All transcriptions re-segmented' })
  async resegmentAllTranscriptions(
    @CurrentTenant() tenantId: string,
  ) {
    const result = await this.phoneCallService.resegmentAllTranscriptionsForTenant(tenantId);
    return {
      success: true,
      ...result,
      message: `Re-segmented ${result.processed} call chains, ${result.errors} errors`,
    };
  }
}
