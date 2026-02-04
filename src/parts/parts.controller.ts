import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { PartsService } from './parts.service';
import {
  CreatePartDto,
  UpdatePartDto,
  QueryPartDto,
  CreatePartConditionDto,
  UpdatePartConditionDto,
  CreatePartStatusDto,
  UpdatePartStatusDto,
  CreatePartCategoryDto,
  UpdatePartCategoryDto,
} from './dto';

// TODO: Replace with actual tenant context from auth
const TEMP_TENANT_ID = 'temp-tenant-id';

@ApiTags('Parts')
@ApiBearerAuth()
@Controller('parts')
export class PartsController {
  constructor(private readonly partsService: PartsService) {}

  // ========================================
  // PART CRUD ENDPOINTS
  // ========================================

  @Post()
  @ApiOperation({
    summary: 'Create a new part',
    description: 'Creates a new part in the inventory',
  })
  @ApiResponse({ status: 201, description: 'Part created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Condition, status, or category not found' })
  create(@Body() createPartDto: CreatePartDto) {
    // TODO: Get tenantId from auth context
    return this.partsService.create(TEMP_TENANT_ID, createPartDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all parts',
    description: 'Retrieves a paginated list of parts with optional filters',
  })
  @ApiResponse({ status: 200, description: 'List of parts' })
  findAll(@Query() query: QueryPartDto) {
    return this.partsService.findAll(TEMP_TENANT_ID, query);
  }

  @Get('low-stock')
  @ApiOperation({
    summary: 'Get low stock parts',
    description: 'Retrieves parts where quantity is at or below minimum quantity',
  })
  @ApiResponse({ status: 200, description: 'List of low stock parts' })
  getLowStock() {
    return this.partsService.getLowStockParts(TEMP_TENANT_ID);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get part by ID',
    description: 'Retrieves a part by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Part UUID' })
  @ApiResponse({ status: 200, description: 'Part found' })
  @ApiResponse({ status: 404, description: 'Part not found' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.partsService.findOne(TEMP_TENANT_ID, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update part',
    description: 'Updates a part by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Part UUID' })
  @ApiResponse({ status: 200, description: 'Part updated successfully' })
  @ApiResponse({ status: 404, description: 'Part not found' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePartDto: UpdatePartDto,
  ) {
    return this.partsService.update(TEMP_TENANT_ID, id, updatePartDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete part',
    description: 'Deletes a part by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Part UUID' })
  @ApiResponse({ status: 200, description: 'Part deleted successfully' })
  @ApiResponse({ status: 404, description: 'Part not found' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.partsService.remove(TEMP_TENANT_ID, id);
  }

  @Patch(':id/quantity')
  @ApiOperation({
    summary: 'Adjust part quantity',
    description: 'Adjusts the quantity of a part (positive or negative)',
  })
  @ApiParam({ name: 'id', description: 'Part UUID' })
  @ApiResponse({ status: 200, description: 'Quantity adjusted successfully' })
  @ApiResponse({ status: 400, description: 'Cannot reduce below 0' })
  @ApiResponse({ status: 404, description: 'Part not found' })
  adjustQuantity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { adjustment: number; reason?: string },
  ) {
    return this.partsService.updateQuantity(
      TEMP_TENANT_ID,
      id,
      body.adjustment,
      body.reason,
    );
  }

  @Post(':id/sell')
  @ApiOperation({
    summary: 'Mark part as sold',
    description: 'Marks a part as sold and updates inventory',
  })
  @ApiParam({ name: 'id', description: 'Part UUID' })
  @ApiResponse({ status: 200, description: 'Part marked as sold' })
  @ApiResponse({ status: 404, description: 'Part or sold status not found' })
  markAsSold(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { soldToId?: string; soldPrice?: number; soldDealId?: string },
  ) {
    return this.partsService.markAsSold(TEMP_TENANT_ID, id, body);
  }

  // ========================================
  // PART CONDITION ENDPOINTS
  // ========================================

  @Post('conditions')
  @ApiOperation({
    summary: 'Create part condition',
    description: 'Creates a new part condition (New, Used, Rebuilt, etc.)',
  })
  @ApiResponse({ status: 201, description: 'Condition created' })
  @ApiResponse({ status: 409, description: 'Condition slug already exists' })
  createCondition(@Body() dto: CreatePartConditionDto) {
    return this.partsService.createCondition(TEMP_TENANT_ID, dto);
  }

  @Get('conditions')
  @ApiOperation({
    summary: 'Get all part conditions',
    description: 'Retrieves all active part conditions',
  })
  @ApiResponse({ status: 200, description: 'List of conditions' })
  findAllConditions() {
    return this.partsService.findAllConditions(TEMP_TENANT_ID);
  }

  @Patch('conditions/:id')
  @ApiOperation({
    summary: 'Update part condition',
    description: 'Updates a part condition',
  })
  @ApiParam({ name: 'id', description: 'Condition UUID' })
  @ApiResponse({ status: 200, description: 'Condition updated' })
  @ApiResponse({ status: 404, description: 'Condition not found' })
  updateCondition(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartConditionDto,
  ) {
    return this.partsService.updateCondition(TEMP_TENANT_ID, id, dto);
  }

  @Delete('conditions/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete part condition',
    description: 'Deletes a part condition if not in use',
  })
  @ApiParam({ name: 'id', description: 'Condition UUID' })
  @ApiResponse({ status: 200, description: 'Condition deleted' })
  @ApiResponse({ status: 400, description: 'Condition in use' })
  @ApiResponse({ status: 404, description: 'Condition not found' })
  removeCondition(@Param('id', ParseUUIDPipe) id: string) {
    return this.partsService.removeCondition(TEMP_TENANT_ID, id);
  }

  // ========================================
  // PART STATUS ENDPOINTS
  // ========================================

  @Post('statuses')
  @ApiOperation({
    summary: 'Create part status',
    description: 'Creates a new part status (In Stock, Sold, Reserved, etc.)',
  })
  @ApiResponse({ status: 201, description: 'Status created' })
  @ApiResponse({ status: 409, description: 'Status slug already exists' })
  createStatus(@Body() dto: CreatePartStatusDto) {
    return this.partsService.createStatus(TEMP_TENANT_ID, dto);
  }

  @Get('statuses')
  @ApiOperation({
    summary: 'Get all part statuses',
    description: 'Retrieves all active part statuses',
  })
  @ApiResponse({ status: 200, description: 'List of statuses' })
  findAllStatuses() {
    return this.partsService.findAllStatuses(TEMP_TENANT_ID);
  }

  @Patch('statuses/:id')
  @ApiOperation({
    summary: 'Update part status',
    description: 'Updates a part status',
  })
  @ApiParam({ name: 'id', description: 'Status UUID' })
  @ApiResponse({ status: 200, description: 'Status updated' })
  @ApiResponse({ status: 404, description: 'Status not found' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartStatusDto,
  ) {
    return this.partsService.updateStatus(TEMP_TENANT_ID, id, dto);
  }

  @Delete('statuses/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete part status',
    description: 'Deletes a part status if not in use',
  })
  @ApiParam({ name: 'id', description: 'Status UUID' })
  @ApiResponse({ status: 200, description: 'Status deleted' })
  @ApiResponse({ status: 400, description: 'Status in use' })
  @ApiResponse({ status: 404, description: 'Status not found' })
  removeStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.partsService.removeStatus(TEMP_TENANT_ID, id);
  }

  // ========================================
  // PART CATEGORY ENDPOINTS
  // ========================================

  @Post('categories')
  @ApiOperation({
    summary: 'Create part category',
    description: 'Creates a new part category (Engine, Body, Interior, etc.)',
  })
  @ApiResponse({ status: 201, description: 'Category created' })
  @ApiResponse({ status: 409, description: 'Category slug already exists' })
  createCategory(@Body() dto: CreatePartCategoryDto) {
    return this.partsService.createCategory(TEMP_TENANT_ID, dto);
  }

  @Get('categories')
  @ApiOperation({
    summary: 'Get all part categories',
    description: 'Retrieves all active part categories with hierarchy',
  })
  @ApiResponse({ status: 200, description: 'List of categories' })
  findAllCategories() {
    return this.partsService.findAllCategories(TEMP_TENANT_ID);
  }

  @Patch('categories/:id')
  @ApiOperation({
    summary: 'Update part category',
    description: 'Updates a part category',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  updateCategory(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartCategoryDto,
  ) {
    return this.partsService.updateCategory(TEMP_TENANT_ID, id, dto);
  }

  @Delete('categories/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete part category',
    description: 'Deletes a part category if not in use and has no children',
  })
  @ApiParam({ name: 'id', description: 'Category UUID' })
  @ApiResponse({ status: 200, description: 'Category deleted' })
  @ApiResponse({ status: 400, description: 'Category in use or has children' })
  @ApiResponse({ status: 404, description: 'Category not found' })
  removeCategory(@Param('id', ParseUUIDPipe) id: string) {
    return this.partsService.removeCategory(TEMP_TENANT_ID, id);
  }
}
