import { PartialType } from '@nestjs/swagger';
import { CreateVehicleYearDto } from './create-vehicle-year.dto';

export class UpdateVehicleYearDto extends PartialType(CreateVehicleYearDto) {}
