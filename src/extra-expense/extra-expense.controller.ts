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
import { ExtraExpenseService } from './extra-expense.service';
import { CreateExtraExpenseDto } from './dto/create-extra-expense.dto';
import { UpdateExtraExpenseDto } from './dto/update-extra-expense.dto';
import { QueryExtraExpenseDto } from './dto/query-extra-expense.dto';
import { ExtraExpenseEntity } from './entities/extra-expense.entity';
import { PaginatedResponseDto } from '../common/dto/paginated-response.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';

@ApiTags('Extra Expenses')
@Controller('extra-expenses')
export class ExtraExpenseController {
  constructor(private readonly extraExpenseService: ExtraExpenseService) {}

  @Post()
  @AuditLog({
    action: 'create',
    resource: 'extra-expense',
    level: 'medium',
    pii: false,
    compliance: ['routeone', 'dealertrack', 'glba'],
  })
  @ApiOperation({
    summary: 'Create a new extra expense',
    description:
      'Creates a new extra expense for a vehicle. Requires vehicleId, description, and price.',
  })
  @ApiBody({
    type: CreateExtraExpenseDto,
    examples: {
      example1: {
        summary: 'New tires expense',
        value: {
          vehicleId: '123e4567-e89b-12d3-a456-426614174000',
          description: 'New tires - Michelin',
          price: 450.00,
        },
      },
      example2: {
        summary: 'Repair with receipt',
        value: {
          vehicleId: '123e4567-e89b-12d3-a456-426614174000',
          description: 'Engine repair',
          price: 1250.50,
          receiptId: '123e4567-e89b-12d3-a456-426614174001',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Extra expense successfully created',
    type: ExtraExpenseEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle or receipt not found',
  })
  async create(
    @Body(ValidationPipe) createExtraExpenseDto: CreateExtraExpenseDto,
  ): Promise<ExtraExpenseEntity> {
    return this.extraExpenseService.create(createExtraExpenseDto);
  }

  @Get()
  @AuditLog({
    action: 'read',
    resource: 'extra-expense',
    level: 'low',
    pii: false,
    compliance: ['routeone', 'dealertrack', 'glba'],
  })
  @ApiOperation({
    summary: 'Get all extra expenses with pagination and filters',
    description:
      'Retrieves a paginated list of extra expenses. Supports filtering by vehicle.',
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
    name: 'vehicleId',
    required: false,
    type: String,
    description:
      'Filter by vehicle UUID\\n\\n' +
      '**Examples:**\\n' +
      '• `?vehicleId=123e4567-e89b-12d3-a456-426614174000` - Get all expenses for a specific vehicle',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Successfully retrieved extra expenses',
    type: PaginatedResponseDto<ExtraExpenseEntity>,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle not found when filtering',
  })
  async findAll(
    @Query(ValidationPipe) query: QueryExtraExpenseDto,
  ): Promise<PaginatedResponseDto<ExtraExpenseEntity>> {
    return this.extraExpenseService.findAll(query);
  }

  @Get('vehicle/:vehicleId/total')
  @AuditLog({
    action: 'read',
    resource: 'extra-expense',
    level: 'medium',
    pii: false,
    compliance: ['routeone', 'dealertrack', 'glba'],
  })
  @ApiOperation({
    summary: 'Get total expenses for a vehicle',
    description: 'Calculates the sum of all extra expenses for a specific vehicle.',
  })
  @ApiParam({
    name: 'vehicleId',
    description: 'Vehicle UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Total calculated successfully',
    schema: {
      type: 'object',
      properties: {
        total: {
          type: 'number',
          example: 2750.50,
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Vehicle not found',
  })
  async getVehicleTotal(
    @Param('vehicleId') vehicleId: string,
  ): Promise<{ total: number }> {
    return this.extraExpenseService.getVehicleTotal(vehicleId);
  }

  @Get(':id')
  @AuditLog({
    action: 'read',
    resource: 'extra-expense',
    level: 'low',
    pii: false,
    compliance: ['routeone', 'dealertrack', 'glba'],
  })
  @ApiOperation({
    summary: 'Get an extra expense by ID',
    description: 'Retrieves a single extra expense by its UUID.',
  })
  @ApiParam({
    name: 'id',
    description: 'Extra expense UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Extra expense found',
    type: ExtraExpenseEntity,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Extra expense not found',
  })
  async findOne(@Param('id') id: string): Promise<ExtraExpenseEntity> {
    return this.extraExpenseService.findOne(id);
  }

  @Patch(':id')
  @AuditLog({
    action: 'update',
    resource: 'extra-expense',
    level: 'medium',
    pii: false,
    compliance: ['routeone', 'dealertrack', 'glba'],
  })
  @ApiOperation({
    summary: 'Update an extra expense',
    description:
      'Updates an existing extra expense. All fields are optional.',
  })
  @ApiParam({
    name: 'id',
    description: 'Extra expense UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiBody({
    type: UpdateExtraExpenseDto,
    examples: {
      example1: {
        summary: 'Update description',
        value: {
          description: 'New tires - Michelin Pilot Sport 4S',
        },
      },
      example2: {
        summary: 'Update price',
        value: {
          price: 475.00,
        },
      },
      example3: {
        summary: 'Add receipt',
        value: {
          receiptId: '123e4567-e89b-12d3-a456-426614174001',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Extra expense successfully updated',
    type: ExtraExpenseEntity,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid input data',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Extra expense, vehicle or receipt not found',
  })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) updateExtraExpenseDto: UpdateExtraExpenseDto,
  ): Promise<ExtraExpenseEntity> {
    return this.extraExpenseService.update(id, updateExtraExpenseDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({
    action: 'delete',
    resource: 'extra-expense',
    level: 'high',
    pii: false,
    compliance: ['routeone', 'dealertrack', 'glba'],
  })
  @ApiOperation({
    summary: 'Delete an extra expense',
    description: 'Deletes an extra expense.',
  })
  @ApiParam({
    name: 'id',
    description: 'Extra expense UUID',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Extra expense successfully deleted',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Extra expense with ID xxx has been successfully deleted',
        },
      },
    },
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Extra expense not found',
  })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.extraExpenseService.remove(id);
  }
}
