import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class AskDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  question!: string;

  /** Si falta, se abre una conversacion nueva. */
  @IsOptional()
  @IsUUID('4')
  conversationId?: string;
}
