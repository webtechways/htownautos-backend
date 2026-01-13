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
import { VehicleYearService } from './vehicle-year.service';
import { CreateVehicleYearDto } from './dto/create-vehicle-year.dto';
import { UpdateVehicleYearDto } from './dto/update-vehicle-year.dto';
import { QueryVehicleYearDto } from './dto/query-vehicle-year.dto';
import { VehicleYearEntity } from './entities/vehicle-year.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';

@ApiTags('Vehicle Years')
@Controller('vehicle-years')
export class VehicleYearController {
  constructor(private readonly vehicleYearService: VehicleYearService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new vehicle year',
    description:
      'Creates a new vehicle year entry. Year must be unique and between 1900-2100.',
  })
  @ApiBody({
    type: CreateVehicleYearDto,
    examples: {
      example1: {
        summary: 'Create year 2024',
        value: {
          year: 2024,
          isActive: true,
        },
      },
      example2: {
        summary: 'Create inactive year',
        value: {
          year: 1995,
          isActive: false,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Vehicle year successfully created',
    type: VehicleYearEntity,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174000',
        year: 2024,
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
          'Year must be an integer',
          'Year must be at least 1900',
          'Year must not exceed 2100',
        ],
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Year already exists',
    schema: {
      example: {
        statusCode: 409,
        message: 'Year 2024 already exists',
        error: 'Conflict',
      },
    },
  })
  async create(
    @Body(ValidationPipe) createVehicleYearDto: CreateVehicleYearDto,
  ): Promise<VehicleYearEntity> {
    return this.vehicleYearService.create(createVehicleYearDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all vehicle years with pagination and filters',
    description:
      'Retrieves a paginated list of vehicle years. Supports filtering by year (with operators: eq, gt, lt, gte, lte) and active status.',
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
    description: 'Filter by year (4-digit integer between 1900-2100)',
    example: 2020,
  })
  @ApiQuery({
    name: 'operator',
    required: false,
    enum: ['eq', 'gt', 'lt', 'gte', 'lte'],
    description:
      'Comparison operator for year filter:\n' +
      '• eq - Equal to (default)\n' +
      '• gt - Greater than\n' +
      '• lt - Less than\n' +
      '• gte - Greater than or equal\n' +
      '• lte - Less than or equal\n\n' +
      '**Examples:**\n' +
      '• `?year=2020&operator=eq` - Exactly 2020\n' +
      '• `?year=2010&operator=gt` - Years after 2010 (2011, 2012...)\n' +
      '• `?year=2000&operator=lt` - Years before 2000 (1900...1999)\n' +
      '• `?year=2015&operator=gte` - Years from 2015 onwards (2015, 2016...)\n' +
      '• `?year=2005&operator=lte` - Years up to 2005 (1900...2005)',
    example: 'gte',
  })
  @ApiQuery({
    name: 'isActive',
    required: false,
    type: Boolean,
    description: 'Filter by active status',
    example: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved vehicle years',
    type: PaginatedResponseDto<VehicleYearEntity>,
    schema: {
      example: {
        data: [
          {
            id: '123e4567-e89b-12d3-a456-426614174000',
            year: 2024,
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
          {
            id: '123e4567-e89b-12d3-a456-426614174001',
            year: 2023,
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          total: 128,
          totalPages: 13,
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
  async findAll(
    @Query(ValidationPipe) query: QueryVehicleYearDto,
  ): Promise<PaginatedResponseDto<VehicleYearEntity>> {
    return this.vehicleYearService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get a vehicle year by ID',
    description: 'Retrieves a single vehicle year by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle year UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle year found',
    type: VehicleYearEntity,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle year not found',
  })
  async findOne(@Param('id') id: string): Promise<VehicleYearEntity> {
    return this.vehicleYearService.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a vehicle year',
    description:
      'Updates an existing vehicle year. All fields are optional. Year must remain unique if changed.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle year UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({ type: UpdateVehicleYearDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle year successfully updated',
    type: VehicleYearEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle year not found',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Year already exists',
  })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateVehicleYearDto: UpdateVehicleYearDto,
  ): Promise<VehicleYearEntity> {
    return this.vehicleYearService.update(id, updateVehicleYearDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a vehicle year',
    description:
      'Deletes a vehicle year. Cannot delete if there are related makes. Set isActive to false instead.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle year UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle year successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Vehicle year with ID xxx has been successfully deleted',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle year not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cannot delete year with related makes',
  })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.vehicleYearService.remove(id);
  }
}
