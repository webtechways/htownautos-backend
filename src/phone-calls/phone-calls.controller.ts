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
import { CreatePhoneCallDto, UpdatePhoneCallDto } from './dto/create-phone-call.dto';
import { QueryPhoneCallDto } from './dto/query-phone-call.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import type { AuthenticatedUser } from '../auth/guards/cognito-jwt.guard';

@ApiTags('Phone Calls')
@ApiBearerAuth()
@Controller('phone-calls')
export class PhoneCallsController {
  constructor(private readonly phoneCallsService: PhoneCallsService) {}

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
  findAll(@CurrentTenant() tenantId: string, @Query() query: QueryPhoneCallDto) {
    return this.phoneCallsService.findAll(tenantId, query);
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
  findByBuyer(
    @CurrentTenant() tenantId: string,
    @Param('buyerId', ParseUUIDPipe) buyerId: string,
    @Query() query: QueryPhoneCallDto,
  ) {
    return this.phoneCallsService.findByBuyer(tenantId, buyerId, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get phone call by ID',
    description: 'Retrieves a single phone call by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Phone call UUID' })
  @ApiResponse({ status: 200, description: 'Phone call found' })
  @ApiResponse({ status: 404, description: 'Phone call not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.phoneCallsService.findOne(tenantId, id);
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
}
