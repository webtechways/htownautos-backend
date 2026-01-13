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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { NomenclatorsService } from './nomenclators.service';
import { CreateNomenclatorDto } from './dto/create-nomenclator.dto';
import { UpdateNomenclatorDto } from './dto/update-nomenclator.dto';
import { QueryNomenclatorDto } from './dto/query-nomenclator.dto';
import { NomenclatorEntity } from './entities/nomenclator.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Nomenclators')
@Controller('nom')
export class NomenclatorsController {
  constructor(private readonly nomenclatorsService: NomenclatorsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get all available nomenclator types',
    description: 'Returns a list of all available nomenclator types in the system.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved nomenclator types',
    schema: {
      type: 'object',
      properties: {
        types: {
          type: 'array',
          items: { type: 'string' },
          example: [
            'sale-types',
            'mileage-statuses',
            'vehicle-statuses',
            'title-statuses',
            'vehicle-conditions',
            'brand-statuses',
            'vehicle-types',
            'body-types',
            'fuel-types',
            'drive-types',
            'transmission-types',
            'vehicle-sources',
            'inspection-statuses',
            'activity-types',
            'activity-statuses',
            'user-roles',
            'lead-sources',
            'inquiry-types',
            'preferred-languages',
            'contact-methods',
            'contact-times',
            'genders',
            'id-types',
            'id-states',
            'employment-statuses',
            'occupations',
            'deal-statuses',
            'finance-types',
          ],
        },
      },
    },
  })
  getAvailableTypes(): { types: string[] } {
    return { types: this.nomenclatorsService.getAvailableTypes() };
  }

  @Post(':type')
  @ApiOperation({
    summary: 'Create a new nomenclator entry',
    description: 'Creates a new entry for the specified nomenclator type.',
  })
  @ApiParam({
    name: 'type',
    description: 'Nomenclator type',
    example: 'vehicle-types',
    schema: {
      type: 'string',
      enum: [
        'sale-types',
        'mileage-statuses',
        'vehicle-statuses',
        'title-statuses',
        'vehicle-conditions',
        'brand-statuses',
        'vehicle-types',
        'body-types',
        'fuel-types',
        'drive-types',
        'transmission-types',
        'vehicle-sources',
        'inspection-statuses',
        'activity-types',
        'activity-statuses',
        'user-roles',
        'lead-sources',
        'inquiry-types',
        'preferred-languages',
        'contact-methods',
        'contact-times',
        'genders',
        'id-types',
        'id-states',
        'employment-statuses',
        'occupations',
        'deal-statuses',
        'finance-types',
      ],
    },
  })
  @ApiBody({
    type: CreateNomenclatorDto,
    examples: {
      example1: {
        summary: 'Create sedan body type',
        value: {
          slug: 'sedan',
          title: 'Sedan',
          isActive: true,
        },
      },
      example2: {
        summary: 'Create manual transmission',
        value: {
          slug: 'manual',
          title: 'Manual',
          isActive: true,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Nomenclator entry successfully created',
    type: NomenclatorEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data or nomenclator type',
    schema: {
      example: {
        statusCode: 400,
        message: 'Invalid nomenclator type: invalid-type',
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Slug already exists',
    schema: {
      example: {
        statusCode: 409,
        message: 'vehicle-types with slug "sedan" already exists',
        error: 'Conflict',
      },
    },
  })
  async create(
    @Param('type') type: string,
    @Body(ValidationPipe) createNomenclatorDto: CreateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.create(type, createNomenclatorDto);
  }

  @Get(':type')
  @ApiOperation({
    summary: 'Get all entries for a nomenclator type',
    description:
      'Retrieves a paginated list of all entries for the specified nomenclator type.',
  })
  @ApiParam({
    name: 'type',
    description: 'Nomenclator type',
    example: 'vehicle-types',
  })
  @ApiQuery({
    name: 'page',
    required: false,
    type: Number,
    description: 'Page number (default: 1)',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Items per page (default: 10, max: 100)',
    example: 10,
  })
  @ApiQuery({
    name: 'isActive',
    required: false,
    type: Boolean,
    description:
      'Filter by active status\\n\\n' +
      '**Examples:**\\n' +
      '• `?isActive=true` - Get only active entries\\n' +
      '• `?isActive=false` - Get only inactive entries',
    example: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved nomenclator entries',
    type: PaginatedResponseDto<NomenclatorEntity>,
    schema: {
      example: {
        data: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            slug: 'sedan',
            title: 'Sedan',
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
          {
            id: '123e4567-e89b-12d3-a456-426614174001',
            slug: 'suv',
            title: 'SUV',
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          total: 15,
          totalPages: 2,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid nomenclator type',
  })
  async findAll(
    @Param('type') type: string,
    @Query(ValidationPipe) query: QueryNomenclatorDto,
  ): Promise<PaginatedResponseDto<NomenclatorEntity>> {
    return this.nomenclatorsService.findAll(type, query);
  }

  @Get(':type/:id')
  @ApiOperation({
    summary: 'Get a nomenclator entry by ID',
    description: 'Retrieves a single nomenclator entry by its UUID.',
  })
  @ApiParam({
    name: 'type',
    description: 'Nomenclator type',
    example: 'vehicle-types',
  })
  @ApiParam({
    name: 'id',
    description: 'Nomenclator entry UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Nomenclator entry found',
    type: NomenclatorEntity,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Nomenclator entry not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid nomenclator type',
  })
  async findOne(
    @Param('type') type: string,
    @Param('id') id: string,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findOne(type, id);
  }

  @Get(':type/slug/:slug')
  @ApiOperation({
    summary: 'Get a nomenclator entry by slug',
    description: 'Retrieves a single nomenclator entry by its slug.',
  })
  @ApiParam({
    name: 'type',
    description: 'Nomenclator type',
    example: 'vehicle-types',
  })
  @ApiParam({
    name: 'slug',
    description: 'Nomenclator slug',
    example: 'sedan',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Nomenclator entry found',
    type: NomenclatorEntity,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Nomenclator entry not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid nomenclator type',
  })
  async findBySlug(
    @Param('type') type: string,
    @Param('slug') slug: string,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.findBySlug(type, slug);
  }

  @Patch(':type/:id')
  @ApiOperation({
    summary: 'Update a nomenclator entry',
    description:
      'Updates an existing nomenclator entry. All fields are optional.',
  })
  @ApiParam({
    name: 'type',
    description: 'Nomenclator type',
    example: 'vehicle-types',
  })
  @ApiParam({
    name: 'id',
    description: 'Nomenclator entry UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({
    type: UpdateNomenclatorDto,
    examples: {
      example1: {
        summary: 'Update title',
        value: {
          title: 'Sedan Vehicle',
        },
      },
      example2: {
        summary: 'Deactivate entry',
        value: {
          isActive: false,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Nomenclator entry successfully updated',
    type: NomenclatorEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Nomenclator entry not found',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Slug already exists',
  })
  async update(
    @Param('type') type: string,
    @Param('id') id: string,
    @Body(ValidationPipe) updateNomenclatorDto: UpdateNomenclatorDto,
  ): Promise<NomenclatorEntity> {
    return this.nomenclatorsService.update(type, id, updateNomenclatorDto);
  }

  @Delete(':type/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a nomenclator entry',
    description: 'Deletes a nomenclator entry. Set isActive to false instead if you want to keep the record.',
  })
  @ApiParam({
    name: 'type',
    description: 'Nomenclator type',
    example: 'vehicle-types',
  })
  @ApiParam({
    name: 'id',
    description: 'Nomenclator entry UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Nomenclator entry successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'vehicle-types with ID xxx has been successfully deleted',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Nomenclator entry not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid nomenclator type',
  })
  async remove(
    @Param('type') type: string,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    return this.nomenclatorsService.remove(type, id);
  }
}
