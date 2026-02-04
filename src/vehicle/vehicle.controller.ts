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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { VehicleService } from './vehicle.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { QueryVehicleDto } from './dto/query-vehicle.dto';
import { Vehicle } from './entities/vehicle.entity';
import { AuditLog } from '../common/decorators/audit-log.decorator';

/**
 * Vehicle Controller
 * Manages all vehicle-related endpoints
 * RouteOne/DealerTrack compliant API
 */
@ApiTags('Vehicles')
@Controller('vehicles')
export class VehicleController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new vehicle',
    description:
      'Creates a new vehicle in the inventory. VIN must be unique. RouteOne/DealerTrack compliant.',
  })
  @ApiResponse({
    status: 201,
    description: 'Vehicle successfully created',
    type: Vehicle,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 409, description: 'VIN or stock number already exists' })
  @AuditLog({
    action: 'create',
    resource: 'Vehicle',
    level: 'medium',
    pii: false,
    compliance: ['RouteOne', 'DealerTrack'],
  })
  create(@Body() createVehicleDto: CreateVehicleDto) {
    return this.vehicleService.create(createVehicleDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all vehicles',
    description:
      'Retrieves all vehicles with pagination and filtering options',
  })
  @ApiResponse({
    status: 200,
    description: 'List of vehicles with pagination metadata',
  })
  @AuditLog({
    action: 'read',
    resource: 'Vehicle',
    level: 'low',
    pii: false,
  })
  findAll(@Query() query: QueryVehicleDto) {
    return this.vehicleService.findAll(query);
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get vehicle statistics',
    description: 'Get aggregated statistics about vehicles in inventory',
  })
  @ApiResponse({
    status: 200,
    description: 'Vehicle statistics',
  })
  @AuditLog({
    action: 'read',
    resource: 'Vehicle',
    level: 'low',
    pii: false,
  })
  getStats() {
    return this.vehicleService.getStats();
  }

  @Get('vin/:vin')
  @ApiOperation({
    summary: 'Find vehicle by VIN',
    description: 'Retrieves a single vehicle by its VIN',
  })
  @ApiParam({
    name: 'vin',
    description: 'Vehicle Identification Number',
    example: '1HGBH41JXMN109186',
  })
  @ApiResponse({
    status: 200,
    description: 'Vehicle found',
    type: Vehicle,
  })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  @AuditLog({
    action: 'read',
    resource: 'Vehicle',
    level: 'low',
    pii: false,
  })
  findByVin(@Param('vin') vin: string) {
    return this.vehicleService.findByVin(vin);
  }

  @Get(':id/with-metas')
  @ApiOperation({
    summary: 'Find vehicle by ID with metadata',
    description: 'Retrieves a single vehicle by its UUID including all associated metadata',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Vehicle found with metadata',
  })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  @AuditLog({
    action: 'read',
    resource: 'Vehicle',
    level: 'low',
    pii: false,
  })
  findOneWithMetas(@Param('id') id: string) {
    return this.vehicleService.findOneWithMetas(id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Find vehicle by ID',
    description: 'Retrieves a single vehicle by its UUID',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Vehicle found',
    type: Vehicle,
  })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  @AuditLog({
    action: 'read',
    resource: 'Vehicle',
    level: 'low',
    pii: false,
  })
  findOne(@Param('id') id: string) {
    return this.vehicleService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a vehicle',
    description: 'Updates an existing vehicle. All fields are optional.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Vehicle successfully updated',
    type: Vehicle,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  @ApiResponse({ status: 409, description: 'VIN or stock number conflict' })
  @AuditLog({
    action: 'update',
    resource: 'Vehicle',
    level: 'medium',
    pii: false,
    compliance: ['RouteOne', 'DealerTrack'],
    trackChanges: true,
  })
  update(@Param('id') id: string, @Body() updateVehicleDto: UpdateVehicleDto) {
    return this.vehicleService.update(id, updateVehicleDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a vehicle',
    description:
      'Deletes a vehicle from the inventory. This will cascade delete related records.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Vehicle successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: { type: 'string', example: 'Vehicle with ID xxx has been successfully deleted' },
      },
    },
  })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  @AuditLog({
    action: 'delete',
    resource: 'Vehicle',
    level: 'high',
    pii: false,
    compliance: ['RouteOne', 'DealerTrack', 'GLBA'],
    trackChanges: true,
  })
  remove(@Param('id') id: string) {
    return this.vehicleService.remove(id);
  }
}
