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
import { VehicleModelService } from './vehicle-model.service';
import { CreateVehicleModelDto } from './dto/create-vehicle-model.dto';
import { UpdateVehicleModelDto } from './dto/update-vehicle-model.dto';
import { QueryVehicleModelDto } from './dto/query-vehicle-model.dto';
import { VehicleModelEntity } from './entities/vehicle-model.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';

@ApiTags('Vehicle Models')
@Controller('vehicle-models')
export class VehicleModelController {
  constructor(private readonly vehicleModelService: VehicleModelService) {}

  @Post()
  @AuditLog({
    action: 'create',
    resource: 'vehicle-model',
    level: 'medium',
    pii: false,
    compliance: ['routeone', 'dealertrack'],
  })
  @ApiOperation({
    summary: 'Create a new vehicle model',
    description:
      'Creates a new vehicle model for a specific make. Requires a valid makeId. Model name must be unique within the make.',
  })
  @ApiBody({
    type: CreateVehicleModelDto,
    examples: {
      example1: {
        summary: 'Create Camry for Toyota',
        value: {
          makeId: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Camry',
          isActive: true,
        },
      },
      example2: {
        summary: 'Create F-150 with custom slug',
        value: {
          makeId: '123e4567-e89b-12d3-a456-426614174001',
          name: 'F-150',
          slug: 'f-150',
          isActive: true,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Vehicle model successfully created',
    type: VehicleModelEntity,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174002',
        makeId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Camry',
        slug: 'camry',
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
          'makeId must be a UUID',
          'name must be a string',
          'name should not be empty',
        ],
        error: 'Bad Request',
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
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Model already exists for this make',
    schema: {
      example: {
        statusCode: 409,
        message: 'Model "Camry" already exists for make Toyota',
        error: 'Conflict',
      },
    },
  })
  async create(
    @Body(ValidationPipe) createVehicleModelDto: CreateVehicleModelDto,
  ): Promise<VehicleModelEntity> {
    return this.vehicleModelService.create(createVehicleModelDto);
  }

  @Get()
  @AuditLog({
    action: 'read',
    resource: 'vehicle-model',
    level: 'low',
    pii: false,
    compliance: ['routeone', 'dealertrack'],
  })
  @ApiOperation({
    summary: 'Get all vehicle models with pagination and filters',
    description:
      'Retrieves a paginated list of vehicle models. Supports filtering by make, year, and active status.',
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
    name: 'makeId',
    required: false,
    type: String,
    description:
      'Filter by make UUID\\n\\n' +
      '**Examples:**\\n' +
      '• `?makeId=123e4567-e89b-12d3-a456-426614174000` - Get all models for a specific make',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiQuery({
    name: 'year',
    required: false,
    type: Number,
    description:
      'Filter by year (4-digit integer between 1900-2100)\\n\\n' +
      '**Examples:**\\n' +
      '• `?year=2024` - Get all models from makes in year 2024\\n' +
      '• `?year=2020&isActive=true` - Get all active models from 2020',
    example: 2024,
  })
  @ApiQuery({
    name: 'isActive',
    required: false,
    type: Boolean,
    description:
      'Filter by active status\\n\\n' +
      '**Examples:**\\n' +
      '• `?isActive=true` - Get only active models\\n' +
      '• `?makeId=xxx&isActive=true` - Get active models for a specific make',
    example: true,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved vehicle models',
    type: PaginatedResponseDto<VehicleModelEntity>,
    schema: {
      example: {
        data: [
          {
            id: '123e4567-e89b-12d3-a456-426614174002',
            makeId: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Camry',
            slug: 'camry',
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
          {
            id: '123e4567-e89b-12d3-a456-426614174003',
            makeId: '123e4567-e89b-12d3-a456-426614174000',
            name: 'Corolla',
            slug: 'corolla',
            isActive: true,
            createdAt: '2024-01-12T10:30:00.000Z',
            updatedAt: '2024-01-12T10:30:00.000Z',
          },
        ],
        meta: {
          page: 1,
          limit: 10,
          total: 125,
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
          'makeId must be a UUID',
          'year must be an integer',
          'isActive must be a boolean value',
        ],
        error: 'Bad Request',
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle make or year not found when filtering',
    schema: {
      example: {
        statusCode: 404,
        message: 'Vehicle make with ID xxx not found',
        error: 'Not Found',
      },
    },
  })
  async findAll(
    @Query(ValidationPipe) query: QueryVehicleModelDto,
  ): Promise<PaginatedResponseDto<VehicleModelEntity>> {
    return this.vehicleModelService.findAll(query);
  }

  @Get(':id')
  @AuditLog({
    action: 'read',
    resource: 'vehicle-model',
    level: 'low',
    pii: false,
    compliance: ['routeone', 'dealertrack'],
  })
  @ApiOperation({
    summary: 'Get a vehicle model by ID',
    description: 'Retrieves a single vehicle model by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle model UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle model found',
    type: VehicleModelEntity,
    schema: {
      example: {
        id: '123e4567-e89b-12d3-a456-426614174002',
        makeId: '123e4567-e89b-12d3-a456-426614174000',
        name: 'Camry',
        slug: 'camry',
        isActive: true,
        createdAt: '2024-01-12T10:30:00.000Z',
        updatedAt: '2024-01-12T10:30:00.000Z',
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
  async findOne(@Param('id') id: string): Promise<VehicleModelEntity> {
    return this.vehicleModelService.findOne(id);
  }

  @Patch(':id')
  @AuditLog({
    action: 'update',
    resource: 'vehicle-model',
    level: 'medium',
    pii: false,
    compliance: ['routeone', 'dealertrack'],
  })
  @ApiOperation({
    summary: 'Update a vehicle model',
    description:
      'Updates an existing vehicle model. All fields are optional. Model slug must remain unique within the make if changed.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle model UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @ApiBody({
    type: UpdateVehicleModelDto,
    examples: {
      example1: {
        summary: 'Update model name',
        value: {
          name: 'Camry Hybrid',
        },
      },
      example2: {
        summary: 'Deactivate model',
        value: {
          isActive: false,
        },
      },
      example3: {
        summary: 'Move to different make',
        value: {
          makeId: '123e4567-e89b-12d3-a456-426614174001',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle model successfully updated',
    type: VehicleModelEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle model or make not found',
  })
  @ApiResponse({
    status: HttpStatus.CONFLICT,
    description: 'Model slug already exists for this make',
  })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateVehicleModelDto: UpdateVehicleModelDto,
  ): Promise<VehicleModelEntity> {
    return this.vehicleModelService.update(id, updateVehicleModelDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({
    action: 'delete',
    resource: 'vehicle-model',
    level: 'high',
    pii: false,
    compliance: ['routeone', 'dealertrack'],
  })
  @ApiOperation({
    summary: 'Delete a vehicle model',
    description:
      'Deletes a vehicle model. Cannot delete if there are related trims. Set isActive to false instead.',
  })
  @ApiParam({
    name: 'id',
    description: 'Vehicle model UUID',
    example: '123e4567-e89b-12d3-a456-426614174002',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vehicle model successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Vehicle model with ID xxx has been successfully deleted',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle model not found',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Cannot delete model with related trims',
    schema: {
      example: {
        statusCode: 400,
        message:
          'Cannot delete model with 8 related trims. Set isActive to false instead.',
        error: 'Bad Request',
      },
    },
  })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.vehicleModelService.remove(id);
  }
}
