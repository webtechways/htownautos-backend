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
import { VehicleTrimService } from './vehicle-trim.service';
import { CreateVehicleTrimDto } from './dto/create-vehicle-trim.dto';
import { UpdateVehicleTrimDto } from './dto/update-vehicle-trim.dto';
import { QueryVehicleTrimDto } from './dto/query-vehicle-trim.dto';
import { VehicleTrimEntity } from './entities/vehicle-trim.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Vehicle Trims')
@Controller('vehicle-trims')
export class VehicleTrimController {
  constructor(private readonly vehicleTrimService: VehicleTrimService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new vehicle trim',
    description:
      'Creates a new vehicle trim for a specific model. Requires a valid modelId. Trim name must be unique within the model.',
  })
  @ApiBody({
    type: CreateVehicleTrimDto,
    examples: {
      example1: {
        summary: 'Create LE trim for Camry',
        value: {
          modelId: '123e4567-e89b-12d3-a456-426614174000',
          name: 'LE',
          isActive: true,
        },
      },
      example2: {
        summary: 'Create XLE trim with custom slug',
        value: {
          modelId: '123e4567-e89b-12d3-a456-426614174000',
          name: 'XLE Premium',
          slug: 'xle-premium',
          isActive: true,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Vehicle trim successfully created',
    type: VehicleTrimEntity,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174002',
        modelId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'LE',
        slug: 'le',
        isActive: true,
        createdAt: '2024-01-12T10:30:00.000Z',
        updatedAt: '2024-01-12T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
    schema: {
      example: {
        statusCode: 400,
        message: [
          'modelId must be a UUID',
          'name must be a string',
          'name should not be empty',
        ],
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle model not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Vehicle model with ID xxx not found',
        error: 'Not Found',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Trim already exists for this model',
    schema: {
      example: {
        statusCode: 409,
        message: 'Trim "LE" already exists for model Camry',
        error: 'Conflict',
      },
    },
  })
  async create(
    @Body(ValidationPipe) createVehicleTrimDto: CreateVehicleTrimDto,
  ): Promise<VehicleTrimEntity> {
    return this.vehicleTrimService.create(createVehicleTrimDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all vehicle trims with pagination and filters',
    description:
      'Retrieves a paginated list of vehicle trims. Supports filtering by model, make, year, and active status.',
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
    name: 'modelId',
    required: false,
    type: String,
    description:
      'Filter by model UUID\\n\\n' +
      '**Examples:**\\n' +
      '• `?modelId=123e4567-e89b-12d3-a456-426614174000` - Get all trims for a specific model',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'makeId',
    required: false,
    type: String,
    description:
      'Filter by make UUID\\n\\n' +
      '**Examples:**\\n' +
      '• `?makeId=123e4567-e89b-12d3-a456-426614174001` - Get all trims from models of a specific make',
    example: '123e4567-e89b-12d3-a456-426614174001',
  })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description:
      'Filter by year (4-digit integer between 1900-2100)\\n\\n' +
      '**Examples:**\\n' +
      '• `?year=2024` - Get all trims from 2024 models\\n' +
      '• `?year=2020&isActive=true` - Get all active trims from 2020',
    example: 2024,
  })
  @ApiQuery({
    name: 'isActive',
    required: false,
    type: Boolean,
    description:
      'Filter by active status\\n\\n' +
      '**Examples:**\\n' +
      '• `?isActive=true` - Get only active trims\\n' +
      '• `?modelId=xxx&isActive=true` - Get active trims for a specific model',
    example: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved vehicle trims',
    type: PaginatedResponseDto<VehicleTrimEntity>,
    schema: {
      example: {
        data: [
          {
            id: '123e4567-e89b-12d3-a456-426614174002',
            modelId: '123e4567-e89b-12d3-a456-426614174000',
            name: 'LE',
            slug: 'le',
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
          {
            id: '123e4567-e89b-12d3-a456-426614174003',
            modelId: '123e4567-e89b-12d3-a456-426614174000',
            name: 'XLE',
            slug: 'xle',
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          total: 350,
          totalPages: 35,
          hasNextPage: true,
          hasPreviousPage: false,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters',
    schema: {
      example: {
        statusCode: 400,
        message: [
          'modelId must be a UUID',
          'year must be an integer',
          'isActive must be a boolean value',
        ],
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle model, make or year not found when filtering',
    schema: {
      example: {
        statusCode: 404,
        message: 'Vehicle model with ID xxx not found',
        error: 'Not Found',
      },
    },
  })
  async findAll(
    @Query(ValidationPipe) query: QueryVehicleTrimDto,
  ): Promise<PaginatedResponseDto<VehicleTrimEntity>> {
    return this.vehicleTrimService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a vehicle trim by ID',
    description: 'Retrieves a single vehicle trim by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle trim UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle trim found',
    type: VehicleTrimEntity,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174002',
        modelId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'LE',
        slug: 'le',
        isActive: true,
        createdAt: '2024-01-12T10:30:00.000Z',
        updatedAt: '2024-01-12T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle trim not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Vehicle trim with ID xxx not found',
        error: 'Not Found',
      },
    },
  })
  async findOne(@Param('id') id: string): Promise<VehicleTrimEntity> {
    return this.vehicleTrimService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a vehicle trim',
    description:
      'Updates an existing vehicle trim. All fields are optional. Trim slug must remain unique within the model if changed.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle trim UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @ApiBody({
    type: UpdateVehicleTrimDto,
    examples: {
      example1: {
        summary: 'Update trim name',
        value: {
          name: 'LE Premium',
        },
      },
      example2: {
        summary: 'Deactivate trim',
        value: {
          isActive: false,
        },
      },
      example3: {
        summary: 'Move to different model',
        value: {
          modelId: '123e4567-e89b-12d3-a456-426614174001',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle trim successfully updated',
    type: VehicleTrimEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle trim or model not found',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Trim slug already exists for this model',
  })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateVehicleTrimDto: UpdateVehicleTrimDto,
  ): Promise<VehicleTrimEntity> {
    return this.vehicleTrimService.update(id, updateVehicleTrimDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a vehicle trim',
    description: 'Deletes a vehicle trim. Set isActive to false instead if you want to keep the record.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle trim UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle trim successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Vehicle trim with ID xxx has been successfully deleted',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle trim not found',
  })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.vehicleTrimService.remove(id);
  }
}
