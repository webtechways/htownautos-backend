import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { TitleService } from './title.service';
import { CreateTitleDto } from './dto/create-title.dto';
import { UpdateTitleDto } from './dto/update-title.dto';
import { AuditLog } from '../common/decorators/audit-log.decorator';

@ApiTags('Titles')
@Controller('titles')
export class TitleController {
  constructor(private readonly titleService: TitleService) {}

  @Get('vehicle/:vehicleId')
  @ApiOperation({ summary: 'Get the current title for a vehicle' })
  @ApiParam({ name: 'vehicleId', description: 'Vehicle UUID' })
  @ApiResponse({ status: 200, description: 'Title found or null' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async findByVehicle(@Param('vehicleId') vehicleId: string) {
    return this.titleService.findByVehicle(vehicleId);
  }

  @Post('vehicle/:vehicleId')
  @HttpCode(HttpStatus.OK)
  @AuditLog({
    action: 'update',
    resource: 'title',
    level: 'medium',
    pii: false,
    compliance: ['RouteOne', 'DealerTrack'],
    trackChanges: true,
  })
  @ApiOperation({
    summary: 'Create or update the title for a vehicle',
    description: 'Upserts the title record. If a title exists for the vehicle, it updates it. Otherwise creates a new one.',
  })
  @ApiParam({ name: 'vehicleId', description: 'Vehicle UUID' })
  @ApiResponse({ status: 200, description: 'Title created or updated' })
  @ApiResponse({ status: 404, description: 'Vehicle not found' })
  async upsert(
    @Param('vehicleId') vehicleId: string,
    @Body(ValidationPipe) dto: CreateTitleDto,
  ) {
    return this.titleService.upsert(vehicleId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a title by ID' })
  @ApiParam({ name: 'id', description: 'Title UUID' })
  @ApiResponse({ status: 200, description: 'Title found' })
  @ApiResponse({ status: 404, description: 'Title not found' })
  async findOne(@Param('id') id: string) {
    return this.titleService.findOne(id);
  }

  @Patch(':id')
  @AuditLog({
    action: 'update',
    resource: 'title',
    level: 'medium',
    pii: false,
    compliance: ['RouteOne', 'DealerTrack'],
    trackChanges: true,
  })
  @ApiOperation({ summary: 'Update a title by ID' })
  @ApiParam({ name: 'id', description: 'Title UUID' })
  @ApiResponse({ status: 200, description: 'Title updated' })
  @ApiResponse({ status: 404, description: 'Title not found' })
  async update(
    @Param('id') id: string,
    @Body(ValidationPipe) dto: UpdateTitleDto,
  ) {
    return this.titleService.update(id, dto);
  }
}
