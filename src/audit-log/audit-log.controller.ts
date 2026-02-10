import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  ValidationPipe,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuditLogService } from './audit-log.service';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';
import { CreateAuditLogDto } from './dto/create-audit-log.dto';

@ApiTags('Audit Logs')
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @ApiOperation({ summary: 'Query audit logs with filters' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Paginated audit logs' })
  findAll(@Query(ValidationPipe) query: QueryAuditLogDto) {
    return this.auditLogService.findAll(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new audit log entry' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Audit log created' })
  async create(@Body(ValidationPipe) dto: CreateAuditLogDto, @Req() req: any) {
    // Extract user info from request
    const userId = req.user?.sub || req.user?.cognitoSub;
    const userEmail = req.user?.email || req.user?.['cognito:username'];
    const tenantId = req.headers['x-tenant-id'];
    const ipAddress = req.ip || req.headers['x-forwarded-for']?.split(',')[0];
    const userAgent = req.headers['user-agent'];

    return this.auditLogService.create({
      ...dto,
      userId,
      userEmail,
      tenantId,
      ipAddress,
      userAgent,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single audit log entry' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Audit log entry' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Audit log not found' })
  findOne(@Param('id') id: string) {
    return this.auditLogService.findOne(id);
  }
}
