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
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';

@ApiTags('Parts')
@ApiBearerAuth()
@Controller('parts')
export class PartsController {
  constructor(private readonly partsService: PartsService) {}

  // ========================================
  // PART CRUD ENDPOINTS (Base routes first)
  // ========================================

  @Post()
  @ApiOperation({
    summary: 'Create a new part',
    description: 'Creates a new part in the inventory',
  })
  @ApiResponse({ status: 201, description: 'Part created successfully' })
  @ApiResponse({ status: 400, description: 'Validation error' })
  @ApiResponse({ status: 404, description: 'Condition, status, or category not found' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() createPartDto: CreatePartDto,
  ) {
    return this.partsService.create(tenantId, createPartDto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all parts',
    description: 'Retrieves a paginated list of parts with optional filters',
  })
  @ApiResponse({ status: 200, description: 'List of parts' })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: QueryPartDto,
  ) {
    return this.partsService.findAll(tenantId, query);
  }

  @Get('low-stock')
  @ApiOperation({
    summary: 'Get low stock parts',
    description: 'Retrieves parts where quantity is at or below minimum quantity',
  })
  @ApiResponse({ status: 200, description: 'List of low stock parts' })
  getLowStock(@CurrentTenant() tenantId: string) {
    return this.partsService.getLowStockParts(tenantId);
  }

  @Post('backfill-skus')
  @ApiOperation({
    summary: 'Backfill missing SKUs',
    description: 'Generates SKUs for all parts that do not have one',
  })
  @ApiResponse({ status: 200, description: 'SKUs backfilled successfully' })
  backfillSkus(@CurrentTenant() tenantId: string) {
    return this.partsService.backfillMissingSKUs(tenantId);
  }

  // ========================================
  // PART CONDITION ENDPOINTS
  // IMPORTANT: Static routes must come BEFORE :id routes
  // ========================================

  @Post('conditions')
  @ApiOperation({
    summary: 'Create part condition',
    description: 'Creates a new part condition (New, Used, Rebuilt, etc.)',
  })
  @ApiResponse({ status: 201, description: 'Condition created' })
  @ApiResponse({ status: 409, description: 'Condition slug already exists' })
  createCondition(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreatePartConditionDto,
  ) {
    return this.partsService.createCondition(tenantId, dto);
  }

  @Get('conditions')
  @ApiOperation({
    summary: 'Get all part conditions',
    description: 'Retrieves all active part conditions',
  })
  @ApiResponse({ status: 200, description: 'List of conditions' })
  findAllConditions(@CurrentTenant() tenantId: string) {
    return this.partsService.findAllConditions(tenantId);
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
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartConditionDto,
  ) {
    return this.partsService.updateCondition(tenantId, id, dto);
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
  removeCondition(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.partsService.removeCondition(tenantId, id);
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
  createStatus(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreatePartStatusDto,
  ) {
    return this.partsService.createStatus(tenantId, dto);
  }

  @Get('statuses')
  @ApiOperation({
    summary: 'Get all part statuses',
    description: 'Retrieves all active part statuses',
  })
  @ApiResponse({ status: 200, description: 'List of statuses' })
  findAllStatuses(@CurrentTenant() tenantId: string) {
    return this.partsService.findAllStatuses(tenantId);
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
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartStatusDto,
  ) {
    return this.partsService.updateStatus(tenantId, id, dto);
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
  removeStatus(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.partsService.removeStatus(tenantId, id);
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
  createCategory(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreatePartCategoryDto,
  ) {
    return this.partsService.createCategory(tenantId, dto);
  }

  @Get('categories')
  @ApiOperation({
    summary: 'Get all part categories',
    description: 'Retrieves all active part categories with hierarchy',
  })
  @ApiResponse({ status: 200, description: 'List of categories' })
  findAllCategories(@CurrentTenant() tenantId: string) {
    return this.partsService.findAllCategories(tenantId);
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
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePartCategoryDto,
  ) {
    return this.partsService.updateCategory(tenantId, id, dto);
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
  removeCategory(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.partsService.removeCategory(tenantId, id);
  }

  // ========================================
  // PART :id ROUTES (Must come AFTER static routes)
  // ========================================

  @Get(':id')
  @ApiOperation({
    summary: 'Get part by ID',
    description: 'Retrieves a part by its UUID',
  })
  @ApiParam({ name: 'id', description: 'Part UUID' })
  @ApiResponse({ status: 200, description: 'Part found' })
  @ApiResponse({ status: 404, description: 'Part not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.partsService.findOne(tenantId, id);
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
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updatePartDto: UpdatePartDto,
  ) {
    return this.partsService.update(tenantId, id, updatePartDto);
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
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.partsService.remove(tenantId, id);
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
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { adjustment: number; reason?: string },
  ) {
    return this.partsService.updateQuantity(
      tenantId,
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
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { soldToId?: string; soldPrice?: number; soldDealId?: string },
  ) {
    return this.partsService.markAsSold(tenantId, id, body);
  }
}
