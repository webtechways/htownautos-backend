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

@ApiTags('Nomenclators - Vehicle Conditions')
@Controller('nom/vehicle-conditions')
export class VehicleConditionsController {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Post()
  @AuditLog({ action: 'create', resource: 'vehicle-condition', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Create a new vehicle condition' })
  @ApiResponse({ status: HttpStatus.CREATED, type: NomenclatorEntity })
  async create(
    @Body(ValidationPipe) createDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.create('vehicle-conditions', createDto);
  }

  @Get()
  @AuditLog({ action: 'read', resource: 'vehicle-condition', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get all vehicle conditions' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async findAll(
    @Query(ValidationPipe) query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    return this.nomenclatorsService.findAll('vehicle-conditions', query);
  }

  @Get(':id')
  @AuditLog({ action: 'read', resource: 'vehicle-condition', level: 'low', pii: false })
  @ApiOperation({ summary: 'Get vehicle condition by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async findOne(@Param('id') id: string): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findOne('vehicle-conditions', id);
  }

  @Patch(':id')
  @AuditLog({ action: 'update', resource: 'vehicle-condition', level: 'medium', pii: false })
  @ApiOperation({ summary: 'Update a vehicle condition' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.update('vehicle-conditions', id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({ action: 'delete', resource: 'vehicle-condition', level: 'high', pii: false })
  @ApiOperation({ summary: 'Delete a vehicle condition' })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.nomenclatorsService.remove('vehicle-conditions', id);
  }
}
