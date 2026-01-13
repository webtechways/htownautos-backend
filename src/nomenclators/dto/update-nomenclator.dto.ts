import { PartialType } from '@nestjs/swagger';
import { CreateNomenclatorDto } from './create-nomenclator.dto';

export class UpdateNomenclatorDto extends PartialType(CreateNomenclatorDto) {}
