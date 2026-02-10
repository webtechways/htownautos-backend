import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { VehiclePartsService } from './vehicle-parts.service';
import { CreateVehiclePartDto, CreatePartAndAssociateDto } from './dto/vehicle-part.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

@ApiTags('Vehicle Parts')
@ApiBearerAuth()
@Controller('vehicles/:vehicleId/parts')
export class VehiclePartsController {
  constructor(private readonly vehiclePartsService: VehiclePartsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all parts associated with a vehicle',
    description: 'Retrieves all parts that have been associated/installed on a vehicle',
  })
  @ApiParam({ name: 'vehicleId', description: 'Vehicle UUID' })
  @ApiResponse({ status: 200, description: 'List of vehicle parts with total' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  findByVehicle(
    @CurrentTenant() tenantId: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
  ) {
    return this.vehiclePartsService.findByVehicle(vehicleId, tenantId);
  }

  @Get('available')
  @ApiOperation({
    summary: 'Get available parts from inventory',
    description: 'Retrieves parts with stock available for association',
  })
  @ApiParam({ name: 'vehicleId', description: 'Vehicle UUID' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by name, part number, or SKU' })
  @ApiResponse({ status: 200, description: 'List of available parts' })
  getAvailableParts(
    @CurrentTenant() tenantId: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Query('search') search?: string,
  ) {
    // vehicleId is included for route consistency but not used in query
    return this.vehiclePartsService.getAvailableParts(tenantId, search);
  }

  @Post()
  @ApiOperation({
    summary: 'Associate an existing part to a vehicle',
    description: 'Associates an existing part from inventory to a vehicle and reduces stock',
  })
  @ApiParam({ name: 'vehicleId', description: 'Vehicle UUID' })
  @ApiResponse({ status: 201, description: 'Part associated successfully' })
  @ApiResponse({ status: 400, description: 'Not enough stock' })
  @ApiResponse({ status: 404, description: 'Vehicle or part not found' })
  associatePart(
    @CurrentTenant() tenantId: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: CreateVehiclePartDto,
  ) {
    return this.vehiclePartsService.associatePart(vehicleId, dto, tenantId);
  }

  @Post('create')
  @ApiOperation({
    summary: 'Create a new part and associate it to a vehicle',
    description: 'Creates a new part in inventory AND associates it to the vehicle in one operation',
  })
  @ApiParam({ name: 'vehicleId', description: 'Vehicle UUID' })
  @ApiResponse({ status: 201, description: 'Part created and associated successfully' })
  @ApiResponse({ status: 404, description: 'Vehicle, condition, or status not found' })
  createAndAssociate(
    @CurrentTenant() tenantId: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Body() dto: CreatePartAndAssociateDto,
  ) {
    return this.vehiclePartsService.createAndAssociate(vehicleId, dto, tenantId);
  }

  @Delete(':vehiclePartId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Remove a part association from a vehicle',
    description: 'Removes the association between a part and a vehicle. Optionally restores stock.',
  })
  @ApiParam({ name: 'vehicleId', description: 'Vehicle UUID' })
  @ApiParam({ name: 'vehiclePartId', description: 'VehiclePart association UUID' })
  @ApiQuery({ name: 'restoreStock', required: false, description: 'Whether to restore stock to inventory' })
  @ApiResponse({ status: 200, description: 'Association removed' })
  @ApiResponse({ status: 404, description: 'Vehicle or association not found' })
  removeAssociation(
    @CurrentTenant() tenantId: string,
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Param('vehiclePartId', ParseUUIDPipe) vehiclePartId: string,
    @Query('restoreStock') restoreStock?: string,
  ) {
    const shouldRestore = restoreStock === 'true';
    return this.vehiclePartsService.removeAssociation(
      vehicleId,
      vehiclePartId,
      tenantId,
      shouldRestore,
    );
  }
}
