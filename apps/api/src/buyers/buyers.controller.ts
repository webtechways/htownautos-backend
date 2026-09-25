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
  ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';
import { BuyersService } from './buyers.service';
import { CreateBuyerDto } from './dto/create-buyer.dto';
import { UpdateBuyerDto } from './dto/update-buyer.dto';
import { QueryBuyerDto } from './dto/query-buyer.dto';
import { BuyerEntity } from './entities/buyer.entity';
import { PaginatedResponseDto } from '@htownautos/common';
import { AuditLog } from '@htownautos/common';
import { CurrentTenant } from '@htownautos/auth';

@ApiTags('Buyers')
@Controller('buyers')
export class BuyersController {
  constructor(private readonly service: BuyersService) {}

  @Post()
  @AuditLog({
    action: 'create',
    resource: 'buyer',
    level: 'high',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
  })
  @ApiOperation({ summary: 'Create a new buyer' })
  @ApiBody({
    type: CreateBuyerDto,
    examples: {
      basic: {
        summary: 'Basic buyer',
        value: {
          firstName: 'John',
          lastName: 'Doe',
          dateOfBirth: '1985-06-15',
          email: 'john.doe@email.com',
          phoneMain: '(555) 123-4567',
          currentAddress: '123 Main St',
          currentCity: 'Houston',
          currentState: 'TX',
          currentZipCode: '77001',
        },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: BuyerEntity })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  create(
    @CurrentTenant() tenantId: string,
    @Body() dto: CreateBuyerDto,
  ): Promise<BuyerEntity> {
    return this.service.create(dto, tenantId);
  }

  // ── Buyer files (PDF/images/docs — private, staff-only) ────────────────────

  @Post(':id/files/presign')
  @ApiOperation({ summary: 'Presigned PUT URL to upload a buyer file' })
  presignFile(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { filename: string; contentType: string },
  ) {
    return this.service.presignFile(id, tenantId, body.filename, body.contentType);
  }

  @Post(':id/files')
  @ApiOperation({ summary: 'Register an uploaded buyer file' })
  saveFile(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { key: string; filename: string; contentType: string; size: number },
  ) {
    return this.service.saveFile(id, tenantId, body);
  }

  @Get(':id/files')
  @ApiOperation({ summary: 'List a buyer files (with short-lived download URLs)' })
  listFiles(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.listFiles(id, tenantId);
  }

  @Delete(':id/files/:mediaId')
  @ApiOperation({ summary: 'Delete a buyer file' })
  deleteFile(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.service.deleteFile(id, tenantId, mediaId);
  }

  // ── KYC ID documents (private, staff-only, audited) ────────────────────────

  @Post(':id/id-document/presign')
  @ApiOperation({ summary: 'Presigned PUT URL to upload a buyer ID document' })
  presignIdDocument(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { side: 'front' | 'back'; contentType: string },
  ) {
    return this.service.presignIdDocument(id, tenantId, body.side, body.contentType);
  }

  @Patch(':id/id-document')
  @AuditLog({ action: 'update', resource: 'buyer', level: 'high', pii: true, compliance: ['glba'] })
  @ApiOperation({ summary: 'Persist an uploaded buyer ID document key' })
  saveIdDocument(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { side: 'front' | 'back'; key: string },
  ) {
    return this.service.saveIdDocument(id, tenantId, body.side, body.key);
  }

  @Patch(':id/id-document/from-media')
  @AuditLog({ action: 'update', resource: 'buyer', level: 'high', pii: true, compliance: ['glba'] })
  @ApiOperation({ summary: 'Adopt an ID document from a buyer upload-session media' })
  saveIdDocumentFromMedia(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { side: 'front' | 'back'; mediaId: string },
  ) {
    return this.service.saveIdDocumentFromMedia(id, tenantId, body.side, body.mediaId);
  }

  @Get(':id/id-document/:side')
  @AuditLog({ action: 'read', resource: 'buyer', level: 'high', pii: true, compliance: ['glba'] })
  @ApiOperation({ summary: 'Short-lived presigned URL to view a buyer ID document' })
  getIdDocument(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('side') side: 'front' | 'back',
  ) {
    return this.service.getIdDocumentUrl(id, tenantId, side);
  }

  @Get('check-duplicate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if buyer with email or phone already exists' })
  @ApiQuery({ name: 'email', required: false, type: String })
  @ApiQuery({ name: 'phoneMain', required: false, type: String })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Returns whether email or phone already exists',
    schema: {
      type: 'object',
      properties: {
        emailExists: { type: 'boolean' },
        phoneExists: { type: 'boolean' },
      },
    },
  })
  checkDuplicate(
    @CurrentTenant() tenantId: string,
    @Query('email') email?: string,
    @Query('phoneMain') phoneMain?: string,
  ): Promise<{ emailExists: boolean; phoneExists: boolean }> {
    return this.service.checkDuplicate(tenantId, email, phoneMain);
  }

  @Get()
  @AuditLog({
    action: 'read',
    resource: 'buyer',
    level: 'medium',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
  })
  @ApiOperation({ summary: 'List buyers (paginated)' })
  @ApiQuery({ name: 'page', required: false, type: Number, example: 1 })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 10 })
  @ApiQuery({ name: 'search', required: false, type: String, description: 'Search by name, email, or phone' })
  @ApiQuery({ name: 'email', required: false, type: String })
  @ApiQuery({ name: 'lastName', required: false, type: String })
  @ApiQuery({ name: 'phone', required: false, type: String })
  @ApiQuery({ name: 'city', required: false, type: String })
  @ApiQuery({ name: 'state', required: false, type: String })
  @ApiQuery({ name: 'isBusinessBuyer', required: false, type: Boolean })
  @ApiResponse({ status: HttpStatus.OK, type: PaginatedResponseDto<BuyerEntity> })
  findAll(
    @CurrentTenant() tenantId: string,
    @Query() query: QueryBuyerDto,
  ): Promise<PaginatedResponseDto<BuyerEntity>> {
    return this.service.findAll(query, tenantId);
  }

  @Get(':id')
  @AuditLog({
    action: 'read',
    resource: 'buyer',
    level: 'medium',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
  })
  @ApiOperation({ summary: 'Get a buyer by ID' })
  @ApiParam({ name: 'id', description: 'Buyer UUID' })
  @ApiResponse({ status: HttpStatus.OK, type: BuyerEntity })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Buyer not found' })
  findOne(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<BuyerEntity> {
    return this.service.findOne(id, tenantId);
  }

  @Patch(':id')
  @AuditLog({
    action: 'update',
    resource: 'buyer',
    level: 'high',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
    trackChanges: true,
  })
  @ApiOperation({ summary: 'Update a buyer' })
  @ApiParam({ name: 'id', description: 'Buyer UUID' })
  @ApiBody({
    type: UpdateBuyerDto,
    examples: {
      phone: {
        summary: 'Update phone',
        value: { phoneMain: '(555) 999-8888' },
      },
      address: {
        summary: 'Update address',
        value: {
          currentAddress: '456 Oak Ave',
          currentCity: 'Dallas',
          currentState: 'TX',
          currentZipCode: '75201',
        },
      },
    },
  })
  @ApiResponse({ status: HttpStatus.OK, type: BuyerEntity })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Buyer not found' })
  update(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBuyerDto,
  ): Promise<BuyerEntity> {
    return this.service.update(id, dto, tenantId);
  }

  @Delete('bulk')
  @HttpCode(HttpStatus.OK)
  @AuditLog({
    action: 'bulk-delete',
    resource: 'buyer',
    level: 'critical',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
    trackChanges: true,
  })
  @ApiOperation({ summary: 'Bulk delete buyers' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Buyers deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'One or more buyers not found' })
  removeBulk(
    @CurrentTenant() tenantId: string,
    @Body() body: { ids: string[] },
  ): Promise<{ message: string; count: number }> {
    return this.service.removeBulk(body.ids, tenantId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @AuditLog({
    action: 'delete',
    resource: 'buyer',
    level: 'critical',
    pii: true,
    compliance: ['routeone', 'dealertrack', 'glba', 'fcra'],
    trackChanges: true,
  })
  @ApiOperation({ summary: 'Delete a buyer' })
  @ApiParam({ name: 'id', description: 'Buyer UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Buyer deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Buyer not found' })
  remove(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ message: string }> {
    return this.service.remove(id, tenantId);
  }

  // ── Portal access (CLERK-SYNC-DESIGN.md, package B2) ────────────────────────

  @Get(':id/portal-access')
  @ApiOperation({ summary: "Buyer's Clerk portal-access sync status" })
  @ApiParam({ name: 'id', description: 'Buyer UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Portal access status' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Buyer not found' })
  getPortalAccess(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.getPortalAccess(id, tenantId);
  }

  @Post(':id/portal-access/retry')
  @HttpCode(HttpStatus.OK)
  @AuditLog({ action: 'update', resource: 'buyer', level: 'medium', pii: true })
  @ApiOperation({ summary: 'Re-enqueue the Clerk identity push for this buyer' })
  @ApiParam({ name: 'id', description: 'Buyer UUID' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Re-enqueued' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Buyer not found' })
  retryPortalAccess(
    @CurrentTenant() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.retryPortalAccess(id, tenantId);
  }
}
