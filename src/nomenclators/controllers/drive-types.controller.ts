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
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NomenclatorsService } from '../nomenclators.service';
import { CreateNomenclatorDto } from '../dto/create-nomenclator.dto';
import { UpdateNomenclatorDto } from '../dto/update-nomenclator.dto';
import { QueryNomenclatorDto } from '../dto/query-nomenclator.dto';
import { NomenclatorEntity } from '../entities/nomenclator.entity';
import { PaginatedResponseDto } from '../../common/dto/paginated-response.dto';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

@ApiTags('Nomenclators - Drive Types')
@Controller('nom/drive-types')
export class DriveTypesController {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Post()
  @AuditLog({ action: 'create', resource: 'drive-type', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Create a new drive type' })
  @ApiResponse({ status: HttpStatus.CREATED, type: NomenclatorEntity })
  async create(
    @Body(ValidationPipe) createDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.create('drive-types', createDto);
  }

  @Get()
  @AuditLog({ action: 'read', resource: 'drive-type', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get all drive types' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async findAll(
    @Query(ValidationPipe) query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    return this.nomenclatorsService.findAll('drive-types', query);
  }

  @Get(':id')
  @AuditLog({ action: 'read', resource: 'drive-type', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get drive type by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async findOne(@Param('id') id: string): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findOne('drive-types', id);
  }

  @Patch(':id')
  @AuditLog({ action: 'update', resource: 'drive-type', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Update a drive type' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.update('drive-types', id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({ action: 'delete', resource: 'drive-type', level: 'high', pii: false })
  @ApiOperation({ summary: 'Delete a drive type' })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.nomenclatorsService.remove('drive-types', id);
  }
}
