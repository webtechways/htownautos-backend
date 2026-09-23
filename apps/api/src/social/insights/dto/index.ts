import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

const POST_SORT_FIELDS = ['date', 'impressions', 'engagements', 'engagementRate'] as const;

export class InsightsQueryDto {
  /** CSV of account ids. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  accountIds?: string;

  @ApiProperty({ example: '2026-08-01', description: 'YYYY-MM-DD' })
  @IsDateString()
  from!: string;

  @ApiProperty({ example: '2026-08-31', description: 'YYYY-MM-DD' })
  @IsDateString()
  to!: string;
}

export class PostInsightsQueryDto extends InsightsQueryDto {
  @ApiPropertyOptional({ enum: POST_SORT_FIELDS })
  @IsOptional()
  @IsIn(POST_SORT_FIELDS)
  sort?: (typeof POST_SORT_FIELDS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}

export class InsightsExportQueryDto extends InsightsQueryDto {
  @ApiProperty({ enum: ['csv'] })
  @IsIn(['csv'])
  format!: 'csv';
}

export class BestTimesQueryDto {
  @ApiProperty()
  @IsUUID()
  accountId!: string;
}

export class SyncInsightsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
