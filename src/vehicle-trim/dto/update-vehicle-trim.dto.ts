import { PartialType } from '@nestjs/swagger';
import { CreateVehicleTrimDto } from './create-vehicle-trim.dto';

export class UpdateVehicleTrimDto extends PartialType(CreateVehicleTrimDto) {}
