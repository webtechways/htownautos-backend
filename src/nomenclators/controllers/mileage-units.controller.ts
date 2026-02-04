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

@ApiTags('Nomenclators - Mileage Units')
@Controller('nom/mileage-units')
export class MileageUnitsController {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Post()
  @AuditLog({ action: 'create', resource: 'mileage-unit', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Create a new mileage unit' })
  @ApiResponse({ status: HttpStatus.CREATED, type: NomenclatorEntity })
  async create(
    @Body(ValidationPipe) createDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.create('mileage-units', createDto);
  }

  @Get()
  @AuditLog({ action: 'read', resource: 'mileage-unit', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get all mileage units' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async findAll(
    @Query(ValidationPipe) query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    return this.nomenclatorsService.findAll('mileage-units', query);
  }

  @Get(':id')
  @AuditLog({ action: 'read', resource: 'mileage-unit', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get mileage unit by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async findOne(@Param('id') id: string): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findOne('mileage-units', id);
  }

  @Patch(':id')
  @AuditLog({ action: 'update', resource: 'mileage-unit', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Update a mileage unit' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.update('mileage-units', id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({ action: 'delete', resource: 'mileage-unit', level: 'high', pii: false })
  @ApiOperation({ summary: 'Delete a mileage unit' })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.nomenclatorsService.remove('mileage-units', id);
  }
}
