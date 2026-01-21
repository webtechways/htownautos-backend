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

@ApiTags('Nomenclators - Occupations')
@Controller('nom/occupations')
export class OccupationsController {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Post()
  @AuditLog({ action: 'create', resource: 'occupation', level: 'medium', pii: true })
  @ApiOperation({ summary: 'Create a new occupation' })
  @ApiResponse({ status: HttpStatus.CREATED, type: NomenclatorEntity })
  async create(
    @Body(ValidationPipe) createDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.create('occupations', createDto);
  }

  @Get()
  @AuditLog({ action: 'read', resource: 'occupation', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get all occupations' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async findAll(
    @Query(ValidationPipe) query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    return this.nomenclatorsService.findAll('occupations', query);
  }

  @Get(':id')
  @AuditLog({ action: 'read', resource: 'occupation', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get occupation by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async findOne(@Param('id') id: string): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findOne('occupations', id);
  }

  @Patch(':id')
  @AuditLog({ action: 'update', resource: 'occupation', level: 'medium', pii: true })
  @ApiOperation({ summary: 'Update a occupation' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.update('occupations', id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({ action: 'delete', resource: 'occupation', level: 'high', pii: true })
  @ApiOperation({ summary: 'Delete a occupation' })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.nomenclatorsService.remove('occupations', id);
  }
}
