import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { MetaService } from './meta.service';
import { CreateMetaDto } from './dto/create-meta.dto';
import { UpdateMetaDto } from './dto/update-meta.dto';
import { QueryMetaDto } from './dto/query-meta.dto';
import { Meta } from './entities/meta.entity';
import { AuditLog } from '../common/decorators/audit-log.decorator';

@ApiTags('Meta')
@Controller('meta')
export class MetaController {
  constructor(private readonly metaService: MetaService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new meta entry',
    description: 'Creates a new metadata entry for any entity in the system',
  })
  @ApiResponse({
    status: 201,
    description: 'Meta created successfully',
    type: Meta,
  })
  @ApiResponse({ status: 409, description: 'Meta with same key already exists' })
  @AuditLog({
    action: 'create',
    resource: 'meta',
    level: 'medium',
    pii: false,
    compliance: [],
  })
  create(@Body() createMetaDto: CreateMetaDto) {
    return this.metaService.create(createMetaDto);
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Bulk create meta entries',
    description: 'Creates multiple metadata entries at once',
  })
  @ApiResponse({
    status: 201,
    description: 'Metas created successfully',
    type: [Meta],
  })
  @AuditLog({
    action: 'bulk_create',
    resource: 'meta',
    level: 'medium',
    pii: false,
    compliance: [],
  })
  bulkCreate(@Body() createMetaDtos: CreateMetaDto[]) {
    return this.metaService.bulkCreate(createMetaDtos);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all metas',
    description: 'Retrieves all metadata entries with optional filters',
  })
  @ApiResponse({
    status: 200,
    description: 'List of metas',
  })
  @AuditLog({
    action: 'list',
    resource: 'meta',
    level: 'low',
    pii: false,
    compliance: [],
  })
  findAll(@Query() queryDto: QueryMetaDto) {
    return this.metaService.findAll(queryDto);
  }

  @Get('entity/:entityType/:entityId')
  @ApiOperation({
    summary: 'Get all metas for an entity',
    description: 'Retrieves all metadata for a specific entity',
  })
  @ApiParam({ name: 'entityType', description: 'Type of entity' })
  @ApiParam({ name: 'entityId', description: 'ID of entity' })
  @ApiResponse({
    status: 200,
    description: 'List of metas for the entity',
    type: [Meta],
  })
  @AuditLog({
    action: 'list_by_entity',
    resource: 'meta',
    level: 'low',
    pii: false,
    compliance: [],
  })
  findByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.metaService.findByEntity(entityType, entityId);
  }

  @Get('entity/:entityType/:entityId/key/:key')
  @ApiOperation({
    summary: 'Get a specific meta by entity and key',
    description: 'Retrieves a specific metadata entry by entity and key',
  })
  @ApiParam({ name: 'entityType', description: 'Type of entity' })
  @ApiParam({ name: 'entityId', description: 'ID of entity' })
  @ApiParam({ name: 'key', description: 'Meta key' })
  @ApiResponse({
    status: 200,
    description: 'Meta entry',
    type: Meta,
  })
  @ApiResponse({ status: 404, description: 'Meta not found' })
  @AuditLog({
    action: 'read',
    resource: 'meta',
    level: 'low',
    pii: false,
    compliance: [],
  })
  findByEntityAndKey(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
    @Param('key') key: string,
  ) {
    return this.metaService.findByEntityAndKey(entityType, entityId, key);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a meta by ID',
    description: 'Retrieves a specific metadata entry by ID',
  })
  @ApiParam({ name: 'id', description: 'Meta ID' })
  @ApiResponse({
    status: 200,
    description: 'Meta entry',
    type: Meta,
  })
  @ApiResponse({ status: 404, description: 'Meta not found' })
  @AuditLog({
    action: 'read',
    resource: 'meta',
    level: 'low',
    pii: false,
    compliance: [],
  })
  findOne(@Param('id') id: string) {
    return this.metaService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a meta',
    description: 'Updates an existing metadata entry',
  })
  @ApiParam({ name: 'id', description: 'Meta ID' })
  @ApiResponse({
    status: 200,
    description: 'Meta updated successfully',
    type: Meta,
  })
  @ApiResponse({ status: 404, description: 'Meta not found' })
  @AuditLog({
    action: 'update',
    resource: 'meta',
    level: 'medium',
    pii: false,
    compliance: [],
  })
  update(@Param('id') id: string, @Body() updateMetaDto: UpdateMetaDto) {
    return this.metaService.update(id, updateMetaDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Soft delete a meta',
    description: 'Soft deletes a metadata entry (marks as deleted)',
  })
  @ApiParam({ name: 'id', description: 'Meta ID' })
  @ApiResponse({ status: 204, description: 'Meta deleted successfully' })
  @ApiResponse({ status: 404, description: 'Meta not found' })
  @AuditLog({
    action: 'delete',
    resource: 'meta',
    level: 'high',
    pii: false,
    compliance: [],
  })
  async remove(@Param('id') id: string) {
    await this.metaService.remove(id);
  }

  @Delete('entity/:entityType/:entityId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete all metas for an entity',
    description: 'Soft deletes all metadata entries for a specific entity',
  })
  @ApiParam({ name: 'entityType', description: 'Type of entity' })
  @ApiParam({ name: 'entityId', description: 'ID of entity' })
  @ApiResponse({
    status: 204,
    description: 'All metas for entity deleted successfully',
  })
  @AuditLog({
    action: 'delete_by_entity',
    resource: 'meta',
    level: 'high',
    pii: false,
    compliance: [],
  })
  async deleteByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    await this.metaService.deleteByEntity(entityType, entityId);
  }

  @Delete('hard/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Hard delete a meta (Admin only)',
    description: 'Permanently deletes a metadata entry from database',
  })
  @ApiParam({ name: 'id', description: 'Meta ID' })
  @ApiResponse({
    status: 204,
    description: 'Meta permanently deleted successfully',
  })
  @ApiResponse({ status: 404, description: 'Meta not found' })
  @AuditLog({
    action: 'hard_delete',
    resource: 'meta',
    level: 'critical',
    pii: false,
    compliance: [],
  })
  async hardDelete(@Param('id') id: string) {
    await this.metaService.hardDelete(id);
  }
}
