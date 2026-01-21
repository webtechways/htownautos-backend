import { PartialType, OmitType } from '@nestjs/swagger';
import { CreateMetaDto } from './create-meta.dto';

/**
 * DTO for updating a meta entry
 * Excludes entityType and entityId as they cannot be changed
 */
export class UpdateMetaDto extends PartialType(
  OmitType(CreateMetaDto, ['entityType', 'entityId'] as const),
) {}
