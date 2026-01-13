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

@ApiTags('Nomenclators - Fuel Types')
@Controller('nom/fuel-types')
export class FuelTypesController {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new fuel type' })
  @ApiResponse({ status: HttpStatus.CREATED, type: NomenclatorEntity })
  async create(
    @Body(ValidationPipe) createDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.create('fuel-types', createDto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all fuel types' })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto })
  async findAll(
    @Query(ValidationPipe) query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    return this.nomenclatorsService.findAll('fuel-types', query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get fuel type by ID' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async findOne(@Param('id') id: string): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findOne('fuel-types', id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a fuel type' })
  @ApiResponse({ status: HttpStatus.OK, type: NomenclatorEntity })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.update('fuel-types', id, updateDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a fuel type' })
  @ApiResponse({ status: HttpStatus.OK })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.nomenclatorsService.remove('fuel-types', id);
  }
}
