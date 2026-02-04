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

@ApiTags('Nomenclators - Vehicle Engines')
@Controller('nom/vehicle-engines')
export class VehicleEnginesController {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Post()
  @AuditLog({ action: 'create', resource: 'vehicle-engine', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Create a new vehicle engine' })
  @ApiResponse({ status: HttpStatus.CREATED, type: NomenclatorEntity })
  async create(
    @Body(ValidationPipe) createDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.create('vehicle-engines', createDto);
  }

  @Get()
  @AuditLog({ action: 'read', resource: 'vehicle-engine', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get all vehicle engines' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async findAll(
    @Query(ValidationPipe) query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    return this.nomenclatorsService.findAll('vehicle-engines', query);
  }

  @Get(':id')
  @AuditLog({ action: 'read', resource: 'vehicle-engine', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get vehicle engine by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async findOne(@Param('id') id: string): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findOne('vehicle-engines', id);
  }

  @Patch(':id')
  @AuditLog({ action: 'update', resource: 'vehicle-engine', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Update a vehicle engine' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.update('vehicle-engines', id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({ action: 'delete', resource: 'vehicle-engine', level: 'high', pii: false })
  @ApiOperation({ summary: 'Delete a vehicle engine' })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.nomenclatorsService.remove('vehicle-engines', id);
  }
}
