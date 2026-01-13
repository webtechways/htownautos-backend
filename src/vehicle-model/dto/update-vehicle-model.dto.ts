import { PartialType } from '@nestjs/swagger';
import { CreateVehicleModelDto } from './create-vehicle-model.dto';

export class UpdateVehicleModelDto extends PartialType(CreateVehicleModelDto) {}
