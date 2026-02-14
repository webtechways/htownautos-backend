import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CallFlowService } from './call-flow.service';
import {
  CreateCallFlowDto,
  UpdateCallFlowDto,
  AssignCallFlowDto,
  CallFlowResponseDto,
} from './dto/call-flow.dto';

@ApiTags('Call Flows')
@ApiBearerAuth()
@Controller('tenants/:tenantId/call-flows')
export class CallFlowController {
  constructor(private readonly callFlowService: CallFlowService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new call flow' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiResponse({ status: 201, description: 'Call flow created', type: CallFlowResponseDto })
  async create(
    @Param('tenantId') tenantId: string,
    @Body() dto: CreateCallFlowDto,
  ): Promise<CallFlowResponseDto> {
    return this.callFlowService.create(tenantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all call flows for tenant' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiResponse({ status: 200, description: 'List of call flows', type: [CallFlowResponseDto] })
  async findAll(@Param('tenantId') tenantId: string): Promise<CallFlowResponseDto[]> {
    return this.callFlowService.findAll(tenantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a call flow by ID' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'id', description: 'Call Flow ID' })
  @ApiResponse({ status: 200, description: 'Call flow details', type: CallFlowResponseDto })
  async findOne(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<CallFlowResponseDto> {
    return this.callFlowService.findOne(tenantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a call flow' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'id', description: 'Call Flow ID' })
  @ApiResponse({ status: 200, description: 'Call flow updated', type: CallFlowResponseDto })
  async update(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() dto: UpdateCallFlowDto,
  ): Promise<CallFlowResponseDto> {
    return this.callFlowService.update(tenantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a call flow' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'id', description: 'Call Flow ID' })
  @ApiResponse({ status: 204, description: 'Call flow deleted' })
  async delete(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.callFlowService.delete(tenantId, id);
  }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate a call flow' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'id', description: 'Call Flow ID to duplicate' })
  @ApiResponse({ status: 201, description: 'Call flow duplicated', type: CallFlowResponseDto })
  async duplicate(
    @Param('tenantId') tenantId: string,
    @Param('id') id: string,
    @Body() body: { name?: string },
  ): Promise<CallFlowResponseDto> {
    return this.callFlowService.duplicate(tenantId, id, body.name);
  }
}

@ApiTags('Phone Numbers')
@ApiBearerAuth()
@Controller('tenants/:tenantId/phone-numbers/:phoneNumberId/call-flow')
export class PhoneNumberCallFlowController {
  constructor(private readonly callFlowService: CallFlowService) {}

  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Assign a call flow to a phone number' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'phoneNumberId', description: 'Phone Number ID' })
  @ApiResponse({ status: 204, description: 'Call flow assigned' })
  async assignCallFlow(
    @Param('tenantId') tenantId: string,
    @Param('phoneNumberId') phoneNumberId: string,
    @Body() dto: AssignCallFlowDto,
  ): Promise<void> {
    return this.callFlowService.assignToPhoneNumber(tenantId, phoneNumberId, dto.callFlowId);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove call flow from a phone number' })
  @ApiParam({ name: 'tenantId', description: 'Tenant ID' })
  @ApiParam({ name: 'phoneNumberId', description: 'Phone Number ID' })
  @ApiResponse({ status: 204, description: 'Call flow removed' })
  async removeCallFlow(
    @Param('tenantId') tenantId: string,
    @Param('phoneNumberId') phoneNumberId: string,
  ): Promise<void> {
    return this.callFlowService.assignToPhoneNumber(tenantId, phoneNumberId, null);
  }
}
