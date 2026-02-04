import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateExtraExpenseDto } from './create-extra-expense.dto';

export class UpdateExtraExpenseDto extends PartialType(
  OmitType(CreateExtraExpenseDto, ['vehicleId'] as const),
) {}
