import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { VehicleService } from './vehicle.service';

/**
 * Public Vehicle Controller
 * Provides read-only access to vehicle listings without authentication
 * Used for public landing pages and sharing vehicle details
 */
@ApiTags('Vehicles (Public)')
@Controller('public/vehicles')
@Public()
@Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 requests per minute
export class VehiclePublicController {
  constructor(private readonly vehicleService: VehicleService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Get public vehicle details',
    description: 'Retrieves public vehicle information for landing pages. No authentication required.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: 200,
    description: 'Public vehicle data',
  })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async findOnePublic(@Param('id') id: string) {
    return this.vehicleService.findOnePublic(id);
  }
}
