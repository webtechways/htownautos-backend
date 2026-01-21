import { PartialType } from '@nestjs/swagger';
import { CreateVehicleDto } from './create-vehicle.dto';

/**
 * DTO for updating a vehicle
 * All fields are optional - inherits from CreateVehicleDto
 */
export class UpdateVehicleDto extends PartialType(CreateVehicleDto) {}
