import {
  IsOptional,
  IsInt,
  Min,
  Max,
  IsBoolean,
  IsIn,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';

export const NOTIFICATION_STATUSES = ['all', 'unread', 'read'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export class ListNotificationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  /**
   * Legacy flag kept for the header popover, which only ever asks for unread.
   * `status` supersedes it; when both arrive, `status` wins.
   */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @IsIn(NOTIFICATION_STATUSES)
  status?: NotificationStatus;

  /** Comma-separated notification types, e.g. `SYNC_FAILED,CUSTOMER_DEPOSIT`. */
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value as string[];
    if (typeof value !== 'string') return undefined;
    const parts = value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    return parts.length ? parts : undefined;
  })
  @IsString({ each: true })
  types?: string[];

  /** Free-text match against title and message. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined,
  )
  search?: string;
}
