import { ApiProperty } from '@nestjs/swagger';
import { MetaEntityType, MetaValueType } from '../dto/create-meta.dto';

/**
 * Meta Entity
 */
export class Meta {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: MetaEntityType })
  entityType: MetaEntityType;

  @ApiProperty()
  entityId: string;

  @ApiProperty({ required: false, nullable: true })
  userId: string | null;

  @ApiProperty()
  key: string;

  @ApiProperty()
  value: string;

  @ApiProperty({ enum: MetaValueType })
  valueType: MetaValueType;

  @ApiProperty({ required: false, nullable: true })
  description: string | null;

  @ApiProperty()
  isPublic: boolean;

  @ApiProperty()
  isSystem: boolean;

  @ApiProperty()
  isActive: boolean;

  @ApiProperty()
  isDeleted: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
