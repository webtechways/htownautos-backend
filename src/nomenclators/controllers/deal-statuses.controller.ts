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

@ApiTags('Nomenclators - Deal Statuses')
@Controller('nom/deal-statuses')
export class DealStatusesController {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Post()
  @AuditLog({ action: 'create', resource: 'deal-status', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Create a new deal statuse' })
  @ApiResponse({ status: HttpStatus.CREATED, type: NomenclatorEntity })
  async create(
    @Body(ValidationPipe) createDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.create('deal-statuses', createDto);
  }

  @Get()
  @AuditLog({ action: 'read', resource: 'deal-status', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get all deal statuses' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async findAll(
    @Query(ValidationPipe) query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    return this.nomenclatorsService.findAll('deal-statuses', query);
  }

  @Get(':id')
  @AuditLog({ action: 'read', resource: 'deal-status', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get deal statuse by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async findOne(@Param('id') id: string): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findOne('deal-statuses', id);
  }

  @Patch(':id')
  @AuditLog({ action: 'update', resource: 'deal-status', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Update a deal statuse' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.update('deal-statuses', id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({ action: 'delete', resource: 'deal-status', level: 'high', pii: false })
  @ApiOperation({ summary: 'Delete a deal statuse' })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.nomenclatorsService.remove('deal-statuses', id);
  }
}
