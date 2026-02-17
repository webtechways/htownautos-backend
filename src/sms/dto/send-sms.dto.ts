import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class SendSmsDto {
  @ApiProperty({ description: 'Buyer ID to send SMS to' })
  @IsUUID()
  @IsNotEmpty()
  buyerId: string;

  @ApiProperty({ description: 'Message content' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1600)
  body: string;

  @ApiPropertyOptional({ description: 'Phone number to send to (defaults to buyer primary phone)' })
  @IsString()
  @IsOptional()
  toNumber?: string;

  @ApiPropertyOptional({ description: 'Twilio phone number ID to send from (defaults to tenant primary)' })
  @IsUUID()
  @IsOptional()
  fromPhoneNumberId?: string;
}
