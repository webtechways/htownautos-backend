import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { BuyersService } from './buyers.service';
import { CreateBuyerDto } from './dto/create-buyer.dto';
import { UpdateBuyerDto } from './dto/update-buyer.dto';
import { QueryBuyerDto } from './dto/query-buyer.dto';
import { BuyerEntity } from './entities/buyer.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

@ApiTags('Buyers')
@Controller('buyers')
export class BuyersController {
  constructor(private readonly service: BuyersService) {}

  @Post()
  @AuditLog({
    action: 'create',
    resource: 'buyer',
    level: 'high',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
  })
  @ApiOperation({ summary: 'Create a new buyer' })
  @ApiBody({
    type: CreateBuyerDto,
    examples: {
      basic: {
        summary: 'Basic buyer',
        value: {
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1985-06-15',
          email: 'john.doe@email.com',
          phoneMain: '(555) 123-4567',
          currentAddress: '123 Main St',
          currentCity: 'Houston',
          currentState: 'TX',
          currentZipCode: '77001',
        },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: BuyerEntity })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateBuyerDto,
  ): Promise<BuyerEntity> {
    return this.service.create(dto, tenantId);
  }

  @Get()
  @AuditLog({
    action: 'read',
    resource: 'buyer',
    level: 'medium',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
  })
  @ApiOperation({ summary: 'List buyers (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by name, email, or phone' })
  @ApiQuery({ name: 'email', required: false, type: String })
  @ApiQuery({ name: 'lastName', required: false, type: String })
  @ApiQuery({ name: 'phone', required: false, type: String })
  @ApiQuery({ name: 'city', required: false, type: String })
  @ApiQuery({ name: 'state', required: false, type: String })
  @ApiQuery({ name: 'isBusinessBuyer', required: false, type: Boolean })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto<BuyerEntity> })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: QueryBuyerDto,
  ): Promise<PaginatedResponseDto<BuyerEntity>> {
    return this.service.findAll(query, tenantId);
  }

  @Get(':id')
  @AuditLog({
    action: 'read',
    resource: 'buyer',
    level: 'medium',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
  })
  @ApiOperation({ summary: 'Get a buyer by ID' })
  @ApiParam({ name: 'id', description: 'Buyer UUID' })
  @ApiResponse({ status: HttpStatus.OK, type: BuyerEntity })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Buyer not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BuyerEntity> {
    return this.service.findOne(id, tenantId);
  }

  @Patch(':id')
  @AuditLog({
    action: 'update',
    resource: 'buyer',
    level: 'high',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
    trackChanges: true,
  })
  @ApiOperation({ summary: 'Update a buyer' })
  @ApiParam({ name: 'id', description: 'Buyer UUID' })
  @ApiBody({
    type: UpdateBuyerDto,
    examples: {
      phone: {
        summary: 'Update phone',
        value: { phoneMain: '(555) 999-8888' },
      },
      address: {
        summary: 'Update address',
        value: {
          currentAddress: '456 Oak Ave',
          currentCity: 'Dallas',
          currentState: 'TX',
          currentZipCode: '75201',
        },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.OK, type: BuyerEntity })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Buyer not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBuyerDto,
  ): Promise<BuyerEntity> {
    return this.service.update(id, dto, tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({
    action: 'delete',
    resource: 'buyer',
    level: 'critical',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
    trackChanges: true,
  })
  @ApiOperation({ summary: 'Delete a buyer' })
  @ApiParam({ name: 'id', description: 'Buyer UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Buyer deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Buyer not found' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    return this.service.remove(id, tenantId);
  }
}
