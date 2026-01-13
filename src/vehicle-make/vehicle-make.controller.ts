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
import { VehicleMakeService } from './vehicle-make.service';
import { CreateVehicleMakeDto } from './dto/create-vehicle-make.dto';
import { UpdateVehicleMakeDto } from './dto/update-vehicle-make.dto';
import { QueryVehicleMakeDto } from './dto/query-vehicle-make.dto';
import { VehicleMakeEntity } from './entities/vehicle-make.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Vehicle Makes')
@Controller('vehicle-makes')
export class VehicleMakeController {
  constructor(private readonly vehicleMakeService: VehicleMakeService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new vehicle make',
    description:
      'Creates a new vehicle make for a specific year. Requires a valid yearId. Make name must be unique within the year.',
  })
  @ApiBody({
    type: CreateVehicleMakeDto,
    examples: {
      example1: {
        summary: 'Create Toyota for 2024',
        value: {
          yearId: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Toyota',
          isActive: true,
        },
      },
      example2: {
        summary: 'Create Ford with custom slug',
        value: {
          yearId: '123e4567-e89b-12d3-a456-426614174001',
          name: 'Ford Motor Company',
          slug: 'ford',
          isActive: true,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Vehicle make successfully created',
    type: VehicleMakeEntity,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174002',
        yearId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Toyota',
        slug: 'toyota',
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
          'yearId must be a UUID',
          'name must be a string',
          'name should not be empty',
        ],
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle year not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Vehicle year with ID xxx not found',
        error: 'Not Found',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Make already exists for this year',
    schema: {
      example: {
        statusCode: 409,
        message: 'Make "Toyota" already exists for year 2024',
        error: 'Conflict',
      },
    },
  })
  async create(
    @Body(ValidationPipe) createVehicleMakeDto: CreateVehicleMakeDto,
  ): Promise<VehicleMakeEntity> {
    return this.vehicleMakeService.create(createVehicleMakeDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all vehicle makes with pagination and filters',
    description:
      'Retrieves a paginated list of vehicle makes. Supports filtering by year and active status.',
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
    name: 'year',
    required: false,
    type: Number,
    description:
      'Filter by year (4-digit integer between 1900-2100)\\n\\n' +
      '**Examples:**\\n' +
      '• `?year=2024` - Get all makes for year 2024\\n' +
      '• `?year=2020&isActive=true` - Get all active makes for 2020',
    example: 2024,
  })
  @ApiQuery({
    name: 'isActive',
    required: false,
    type: Boolean,
    description:
      'Filter by active status\\n\\n' +
      '**Examples:**\\n' +
      '• `?isActive=true` - Get only active makes\\n' +
      '• `?isActive=false` - Get only inactive makes\\n' +
      '• `?year=2024&isActive=true` - Get active makes for 2024',
    example: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved vehicle makes',
    type: PaginatedResponseDto<VehicleMakeEntity>,
    schema: {
      example: {
        data: [
          {
            id: '123e4567-e89b-12d3-a456-426614174002',
            yearId: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Toyota',
            slug: 'toyota',
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
          {
            id: '123e4567-e89b-12d3-a456-426614174003',
            yearId: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Ford',
            slug: 'ford',
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          total: 45,
          totalPages: 5,
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
          'Year must be an integer',
          'Year must be at least 1900',
          'isActive must be a boolean value',
        ],
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle year not found when filtering by year',
    schema: {
      example: {
        statusCode: 404,
        message: 'Vehicle year 2050 not found',
        error: 'Not Found',
      },
    },
  })
  async findAll(
    @Query(ValidationPipe) query: QueryVehicleMakeDto,
  ): Promise<PaginatedResponseDto<VehicleMakeEntity>> {
    return this.vehicleMakeService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a vehicle make by ID',
    description: 'Retrieves a single vehicle make by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle make UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle make found',
    type: VehicleMakeEntity,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174002',
        yearId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Toyota',
        slug: 'toyota',
        isActive: true,
        createdAt: '2024-01-12T10:30:00.000Z',
        updatedAt: '2024-01-12T10:30:00.000Z',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle make not found',
    schema: {
      example: {
        statusCode: 404,
        message: 'Vehicle make with ID xxx not found',
        error: 'Not Found',
      },
    },
  })
  async findOne(@Param('id') id: string): Promise<VehicleMakeEntity> {
    return this.vehicleMakeService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a vehicle make',
    description:
      'Updates an existing vehicle make. All fields are optional. Make slug must remain unique within the year if changed.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle make UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @ApiBody({
    type: UpdateVehicleMakeDto,
    examples: {
      example1: {
        summary: 'Update make name',
        value: {
          name: 'Toyota Motor Corporation',
        },
      },
      example2: {
        summary: 'Deactivate make',
        value: {
          isActive: false,
        },
      },
      example3: {
        summary: 'Move to different year',
        value: {
          yearId: '123e4567-e89b-12d3-a456-426614174001',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle make successfully updated',
    type: VehicleMakeEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle make or year not found',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Make slug already exists for this year',
  })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateVehicleMakeDto: UpdateVehicleMakeDto,
  ): Promise<VehicleMakeEntity> {
    return this.vehicleMakeService.update(id, updateVehicleMakeDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a vehicle make',
    description:
      'Deletes a vehicle make. Cannot delete if there are related models. Set isActive to false instead.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle make UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle make successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Vehicle make with ID xxx has been successfully deleted',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle make not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cannot delete make with related models',
    schema: {
      example: {
        statusCode: 400,
        message:
          'Cannot delete make with 15 related models. Set isActive to false instead.',
        error: 'Bad Request',
      },
    },
  })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.vehicleMakeService.remove(id);
  }
}
