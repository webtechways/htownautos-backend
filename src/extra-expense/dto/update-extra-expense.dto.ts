import { PartialType } from '@nestjs/swagger';
import { CreateExtraExpenseDto } from './create-extra-expense.dto';

export class UpdateExtraExpenseDto extends PartialType(CreateExtraExpenseDto) {}
